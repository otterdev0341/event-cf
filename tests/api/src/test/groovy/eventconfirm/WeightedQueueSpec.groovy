package eventconfirm

import spock.lang.Specification
import spock.lang.Unroll
import spock.util.concurrent.PollingConditions

class WeightedQueueSpec extends Specification {
    @spock.lang.AutoCleanup
    ApiClient api = new ApiClient()
    String path
    String agent
    Map pair

    Map key() { ['Idempotency-Key': UUID.randomUUID().toString()] }

    def setup() {
        api.login()
        def name = 'Weighted-' + UUID.randomUUID()
        def org = api.success('POST', '/organizations', [name: name]).body.organizations.find { it.name == name }.id
        def event = api.success('POST', "/orgs/${org}/events", [name: 'Queue', code: 'QUEUE',
            date: '2027-01-01', location: 'Synthetic', description: '']).body.id
        path = "/orgs/${org}/events/${event}"
        agent = '/agent' + path
        def scopes = ['calls:read', 'calls:result']
        def parent = api.success('POST', "/orgs/${org}/credentials", [name: 'Queue parent', kind: 'org',
            eventId: null, parentId: null, scopes: scopes, expiresAt: '2027-12-31']).body
        def child = api.success('POST', "/orgs/${org}/credentials", [name: 'Queue child', kind: 'event',
            eventId: event, parentId: parent.credential.id, scopes: scopes, expiresAt: '2027-12-31']).body
        pair = ['X-Org-Credential': parent.secret, 'X-Event-Credential': child.secret]
    }

    void importPeople(List phones) {
        def rows = phones.collect { [phone: it, first_name: 'Queue', last_name: 'Person', nickname: '',
            event_code: 'QUEUE', event_date: '2027-01-01', lang_code: 'th'] }
        def preview = api.success('POST', path + '/imports', [rows: rows]).body
        api.success('POST', path + '/imports/' + preview.id + '/commit', null, key())
    }

    Map accepted() {
        new PollingConditions(timeout: 15, delay: 0.2).eventually {
            def people = api.success('GET', agent + '/participants', null, pair).body
            assert people.any { it.attempts.any { a -> a.transport == 'accepted' } }
        }
        def person = api.success('GET', agent + '/participants', null, pair).body.find {
            it.attempts.any { a -> a.transport == 'accepted' }
        }
        [person: person, attempt: person.attempts.find { it.transport == 'accepted' }]
    }

    void result(Map call, String result, String reason = null) {
        api.success('POST', agent + '/calls/' + call.attempt.id + '/result',
            [result: result, reason: reason], pair + key())
    }

    @Unroll
    def 'accepted dispatch follows #weight new to one fail and duplicate results do not redial'() {
        given:
        api.success('PATCH', path + '/queue-policy',
            [ratio: weight, retryRatio: 1, maxRetries: 1, expectedVersion: 1])
        importPeople(['+66810000000'])
        api.success('POST', path + '/runs', [action: 'start'], key())
        def failed = accepted()
        api.success('POST', path + '/runs', [action: 'pause'], key())
        result(failed, 'unknown', 'no_answer')
        importPeople((1..weight).collect { '+6681000000' + it })
        def policy = api.success('GET', path + '/queue-state').body
        // Explicit pause plus matching version resets the next scheduling cycle.
        api.success('PATCH', path + '/queue-policy',
            [ratio: weight, retryRatio: 1, maxRetries: 1, expectedVersion: policy.version])
        api.success('POST', path + '/runs', [action: 'resume'], key())
        when:
        def sequence = []
        (0..weight).each {
            def call = accepted()
            sequence << (call.person.id == failed.person.id ? 'fail' : 'new')
            result(call, 'confirm')
        }
        then:
        sequence == (['new'] * weight) + ['fail']
        def people = api.success('GET', path + '/participants').body
        people.every { it.state == 'stopped' && it.outcome.result == 'confirm' }
        people.find { it.id == failed.person.id }.attempts.size() == 2
        people.find { it.id == failed.person.id }.noAnswerCount == 1
        cleanup:
        if (path) api.request('POST', path + '/runs', [action: 'cancel'], key())
        where:
        weight << [2, 5]
    }
}
