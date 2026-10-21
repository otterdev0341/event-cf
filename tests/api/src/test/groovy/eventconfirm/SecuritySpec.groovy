package eventconfirm

import groovy.json.JsonOutput
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import spock.lang.Specification

class SecuritySpec extends Specification {
    ApiClient api = new ApiClient()

    def 'browser writes reject missing CSRF header and foreign origin'() {
        given:
        def url = api.base + '/event-confirm/api/v1/auth/login'
        def body = JsonOutput.toJson([
            email: System.getenv('TEST_ADMIN_EMAIL'),
            password: System.getenv('TEST_ADMIN_PASSWORD')
        ])
        def client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()
        def request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10))
            .header('Content-Type', 'application/json')
            .POST(HttpRequest.BodyPublishers.ofString(body)).build()
        expect:
        client.send(request, HttpResponse.BodyHandlers.ofString()).statusCode() == 403
        api.request('POST', '/auth/login', [:], ['Origin': 'https://foreign.example']).status == 403
    }

    def 'session uses HttpOnly scoped cookie and logout invalidates captured token'() {
        when:
        api.login()
        def cookie = api.cookies.cookieStore.cookies.find { it.name == 'event_confirm_session' }
        then:
        cookie != null
        cookie.httpOnly
        cookie.path == '/event-confirm/'
        cookie.maxAge == 43200
        api.success('GET', '/auth/session').body.user.id
        when:
        def stolen = cookie.value
        api.success('POST', '/auth/logout')
        def request = HttpRequest.newBuilder(URI.create(api.base + '/event-confirm/api/v1/auth/session'))
            .timeout(Duration.ofSeconds(10))
            .header('Cookie', 'event_confirm_session=' + stolen).GET().build()
        then:
        HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build().send(request, HttpResponse.BodyHandlers.ofString()).statusCode() == 401
        api.request('GET', '/auth/session').status == 401
    }

    def 'anonymous callers cannot access workspace data'() {
        expect:
        api.request('GET', '/orgs/unknown/events').status == 401
        api.request('POST', '/organizations', [name: 'Unauthorized']).status == 401
        api.request('GET', '/agent/orgs/unknown/events/unknown/participants').status == 401
    }
}
