package eventconfirm

import spock.lang.Specification

class WorkspaceSpec extends Specification {
    ApiClient api = new ApiClient()
    String org
    String event
    String path

    def setup() {
        api.login()
        def name = 'Acceptance-' + UUID.randomUUID()
        def profile = api.success('POST', '/organizations', [name: name]).body
        org = profile.organizations.find { it.name == name }.id
        event = api.success('POST', "/orgs/${org}/events", [
            name: 'Acceptance event', code: 'TEST', date: '2027-01-01',
            location: 'Test environment', description: ''
        ]).body.id
        path = "/orgs/${org}/events/${event}"
    }

    def 'event settings persist both ratio weights and max retries with stale version rejection'() {
        when:
        def policy = api.success('PATCH', path + '/queue-policy',
            [ratio: 5, retryRatio: 2, maxRetries: 0, expectedVersion: 1]).body
        then:
        policy.ratio == 5
        policy.retryRatio == 2
        policy.maxAttempts == 1
        api.success('GET', path + '/queue-state').body == policy
        api.request('PATCH', path + '/queue-policy',
            [ratio: 2, retryRatio: 1, maxRetries: 2, expectedVersion: 1]).status == 409
        api.request('PATCH', path + '/queue-policy',
            [ratio: 0, retryRatio: 1, maxRetries: -1, expectedVersion: 2]).status == 422
    }

    def 'FAQ publication isolates draft changes and event category revisions'() {
        when:
        api.success('POST', path + '/categories', [name: 'Travel', expectedRevision: 1])
        api.success('POST', path + '/faqs', [question: 'Where?', answer: 'Main hall', category: 'Travel'])
        def draft = api.success('GET', path + '/knowledge').body
        then:
        draft.draft.size() == 1
        draft.published.empty
        when:
        api.success('POST', path + '/publish')
        api.success('PATCH', path + '/faqs/' + draft.draft[0].id,
            [question: 'Where?', answer: 'Second hall', category: 'Travel', expectedVersion: 1])
        def published = api.success('GET', path + '/knowledge').body
        then:
        published.published[0].answer == 'Main hall'
        published.draft[0].answer == 'Second hall'
        api.request('DELETE', path + '/categories/Travel', [expectedRevision: 2]).status == 409
    }

    def 'imports require language and explicit idempotent commit without starting calls'() {
        given:
        def row = [phone: '+66812345678', first_name: 'Test', last_name: 'Person', nickname: '',
            event_code: 'TEST', event_date: '2027-01-01', lang_code: 'th']
        def preview = api.success('POST', path + '/imports', [rows: [row]]).body
        def key = ['Idempotency-Key': UUID.randomUUID().toString()]
        when:
        api.success('POST', path + '/imports/' + preview.id + '/commit', null, key)
        api.success('POST', path + '/imports/' + preview.id + '/commit', null, key)
        def people = api.success('GET', path + '/participants').body
        then:
        people.size() == 1
        people[0].lang_code == 'th'
        people[0].attempts.empty
        api.success('GET', path + '/queue-state').body.status == 'idle'
        api.success('POST', path + '/imports', [rows: [row + [phone: '+66812345679', lang_code: 'invalid']]]).body.errors
    }

    def 'tickets require valid org assignees and reject reused idempotency keys with different payload'() {
        given:
        def ticket = [title: 'Call me', description: 'Customer callback', type: 'callback',
            assigneeIds: [], dueDate: '']
        def key = ['Idempotency-Key': UUID.randomUUID().toString()]
        when:
        def saved = api.success('POST', path + '/tickets', ticket, key).body
        then:
        api.success('POST', path + '/tickets', ticket, key).body.id == saved.id
        api.request('POST', path + '/tickets', ticket + [title: 'Changed'], key).status == 409
        api.success('PATCH', path + '/tickets/' + saved.id,
            [expectedVersion: 1, status: 'waiting']).body.status == 'waiting'
        api.request('PATCH', path + '/tickets/' + saved.id,
            [expectedVersion: 1, status: 'resolved']).status == 409
    }

    def 'agent requires matching active credential pair and only sees published FAQ'() {
        given:
        def parent = api.success('POST', "/orgs/${org}/credentials", [
            name: 'Org agent', kind: 'org', eventId: null, parentId: null,
            scopes: ['knowledge:read', 'calls:result'], expiresAt: '2027-12-31'
        ]).body
        def child = api.success('POST', "/orgs/${org}/credentials", [
            name: 'Event agent', kind: 'event', eventId: event, parentId: parent.credential.id,
            scopes: ['knowledge:read', 'calls:result'], expiresAt: '2027-12-31'
        ]).body
        def headers = ['X-Org-Credential': parent.secret, 'X-Event-Credential': child.secret]
        def endpoint = "/agent/orgs/${org}/events/${event}/knowledge"
        expect:
        api.success('GET', endpoint, null, headers).body == []
        api.request('GET', endpoint).status == 401
        api.request('POST', "/agent/orgs/${org}/events/${event}/calls/missing/result",
            [result: 'confirm', reason: null, ticket: [
                title: 'Needs ticket scope', description: 'Question', type: 'unanswered', assigneeIds: [], dueDate: ''
            ]], headers + ['Idempotency-Key': UUID.randomUUID().toString()]).status == 403
        when:
        api.success('POST', "/orgs/${org}/credentials/${parent.credential.id}/revoke")
        then:
        api.request('GET', endpoint, null, headers).status == 403
    }
}
