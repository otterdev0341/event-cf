package eventconfirm
import spock.lang.Specification
class ScheduleSpec extends Specification {
    @spock.lang.AutoCleanup
    ApiClient api = new ApiClient()
    String path
    Map rule
    Map key() { ['Idempotency-Key': UUID.randomUUID().toString()] }
    def setup() {
        api.login()
        def name = 'Schedule-' + UUID.randomUUID()
        def org = api.success('POST', '/organizations', [name: name]).body.organizations.find { it.name == name }.id
        def event = api.success('POST', "/orgs/${org}/events", [name: 'Schedule test', code: 'SCHEDULE', date: '2027-01-01', location: 'Test', description: '']).body.id
        path = "/orgs/${org}/events/${event}"
        def preview = api.success('POST', path + '/imports', [rows: [[phone: '+66822221111', first_name: 'Schedule', last_name: 'Test', nickname: '', lang_code: 'th', event_code: 'SCHEDULE', event_date: '2027-01-01']]]).body
        api.success('POST', path + '/imports/' + preview.id + '/commit', null, key())
        def person = api.success('GET', path + '/participants').body[0].id
        rule = [date: '2099-01-01', time: '09:30', recurrence: 'once', weekdays: [], redial: false, participantIds: [person], expectedEventVersion: 1, consent: true]
    }
    def 'schedule creation replay cancellation and tenant ownership are enforced'() {
        given:
        def idempotency = key()
        def saved = api.success('POST', path + '/schedules', rule, idempotency).body
        expect:
        saved.nextAt == '2099-01-01T02:30:00+00:00'
        api.success('POST', path + '/schedules', rule, idempotency).body.id == saved.id
        api.success('GET', path + '/schedules').body.size() == 1
        api.success('GET', path + '/participants').body[0].attempts.empty
        api.request('POST', path + '/schedules', rule, key()).status == 409
        api.request('PATCH', path + '/schedules/' + saved.id, [action: 'cancel', expectedVersion: 7]).status == 409
        api.success('PATCH', path + '/schedules/' + saved.id, [action: 'cancel', expectedVersion: 1]).body.ok
        api.success('GET', path + '/schedules').body[0].status == 'cancelled'
        api.request('PATCH', path + '/schedules/' + saved.id, [action: 'cancel', expectedVersion: 1]).status == 409
    }
    def 'schedules reject missing consent key weekdays and out of event participants'() {
        expect:
        api.request('POST', path + '/schedules', rule).status == 422
        api.request('POST', path + '/schedules', rule + [consent: false], key()).status == 422
        api.request('POST', path + '/schedules', rule + [recurrence: 'weekly'], key()).status == 422
        api.request('POST', path + '/schedules', rule + [participantIds: ['other-event-person']], key()).status == 404
        api.request('POST', path + '/schedules', rule + [expectedEventVersion: 99], key()).status == 409
        api.success('GET', path + '/schedules').body.empty
    }
}
