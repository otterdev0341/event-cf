package eventconfirm

import spock.lang.Specification
import spock.util.concurrent.PollingConditions

class AgentJourneySpec extends Specification {
    ApiClient api = new ApiClient()
    String org
    String event
    String browser
    String agent
    Map headers

    def setup() {
        api.login()
        def name = 'Agent-' + UUID.randomUUID()
        org = api.success('POST', '/organizations', [name: name]).body.organizations.find { it.name == name }.id
        event = api.success('POST', "/orgs/${org}/events", [name: 'Agent journey', code: 'AGENT',
            date: '2027-01-01', location: 'Synthetic test', description: '']).body.id
        browser = "/orgs/${org}/events/${event}"
        agent = "/agent/orgs/${org}/events/${event}"
        def scopes = ['events:read', 'knowledge:read', 'calls:read', 'calls:create', 'calls:result', 'tickets:create']
        def parent = api.success('POST', "/orgs/${org}/credentials", [name: 'Parent', kind: 'org',
            eventId: null, parentId: null, scopes: scopes, expiresAt: '2027-12-31']).body
        def child = api.success('POST', "/orgs/${org}/credentials", [name: 'Child', kind: 'event',
            eventId: event, parentId: parent.credential.id, scopes: scopes, expiresAt: '2027-12-31']).body
        headers = ['X-Org-Credential': parent.secret, 'X-Event-Credential': child.secret]
    }

    def cleanup() {
        if (browser) {
            def state = api.request('GET', browser + '/queue-state')
            if (state.status == 200 && state.body.status in ['running', 'paused']) {
                api.request('POST', browser + '/runs', [action: 'cancel'], key())
            }
        }
    }

    Map key() { ['Idempotency-Key': UUID.randomUUID().toString()] }

    def 'worker acceptance then agent confirmation and ticket persist exactly once'() {
        given:
        api.success('POST', browser + '/categories', [name: 'Travel', expectedRevision: 1])
        api.success('POST', browser + '/faqs', [question: 'Where?', answer: 'Main hall', category: 'Travel'])
        api.success('POST', browser + '/publish')
        def preview = api.success('POST', browser + '/imports', [rows: [[phone: '+66810000111',
            first_name: 'Synthetic', last_name: 'Agent', nickname: '', lang_code: 'en',
            event_code: 'AGENT', event_date: '2027-01-01']]]).body
        api.success('POST', browser + '/imports/' + preview.id + '/commit', null, key())
        def people = api.success('GET', agent + '/participants', null, headers).body
        assert people[0].attempts.empty
        assert api.success('GET', agent + '/knowledge', null, headers).body[0].answer == 'Main hall'
        assert api.success('GET', agent + '/event', null, headers).body.id == event
        assert api.success('GET', agent + '/categories', null, headers).body == ['Travel']
        assert api.success('GET', agent + '/runs', null, headers).body.status == 'idle'
        def startKey = headers + key()
        api.success('POST', agent + '/runs', [action: 'start'], startKey)
        api.success('POST', agent + '/runs', [action: 'start'], startKey)
        def attempt
        new PollingConditions(timeout: 15, delay: 0.2).eventually {
            def polled = api.success('GET', agent + '/participants', null, headers).body
            assert polled[0].attempts.size() == 1
            assert polled[0].attempts[0].transport == 'accepted'
            assert polled[0].attempts[0].id
        }
        attempt = api.success('GET', agent + '/participants', null, headers).body[0].attempts[0].id
        when:
        def result = [result: 'confirm', reason: null, ticket: [title: 'Need transport details',
            description: 'Agent could not answer', type: 'unanswered', assigneeIds: [], dueDate: '']]
        def resultKey = headers + key()
        api.success('POST', agent + '/calls/' + attempt + '/result', result, resultKey)
        api.success('POST', agent + '/calls/' + attempt + '/result', result, resultKey)
        then:
        api.request('POST', agent + '/calls/' + attempt + '/result',
            result + [result: 'decline'], resultKey).status == 409
        def saved = api.success('GET', browser + '/participants').body[0]
        saved.outcome.result == 'confirm'
        saved.state == 'stopped'
        saved.attempts.size() == 1
        saved.lang_code == 'en'
        api.success('GET', browser + '/tickets').body.size() == 1
        api.request('GET', agent + '/participants', null,
            ['X-Org-Credential': headers['X-Event-Credential'],
             'X-Event-Credential': headers['X-Org-Credential']]).status == 403
    }

    def 'pair cannot cross events and writes require idempotency and valid outcomes'() {
        given:
        def other = api.success('POST', "/orgs/${org}/events", [name: 'Other', code: 'OTHER',
            date: '2027-01-01', location: 'Test', description: '']).body.id
        expect:
        api.request('GET', "/agent/orgs/${org}/events/${other}/participants", null, headers).status == 403
        api.request('POST', agent + '/tickets', [:], headers).status == 422
        api.request('POST', agent + '/calls/missing/result',
            [result: 'unknown', reason: null], headers + key()).status == 422
    }
}
