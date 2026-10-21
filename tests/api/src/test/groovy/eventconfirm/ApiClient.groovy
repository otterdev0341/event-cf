package eventconfirm

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

class ApiClient {
    final String base = System.getProperty('event.baseUrl')
    final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL)
    final HttpClient client = HttpClient.newBuilder()
        .cookieHandler(cookies)
        .connectTimeout(Duration.ofSeconds(5)).build()

    Map request(String method, String path, Object body = null, Map headers = [:]) {
        def builder = HttpRequest.newBuilder(URI.create(base + '/event-confirm/api/v1' + path))
            .timeout(Duration.ofSeconds(10))
            .header('Content-Type', 'application/json')
            .header('X-Requested-With', 'EventConfirm')
        headers.each { key, value -> builder.header(key.toString(), value.toString()) }
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() :
            HttpRequest.BodyPublishers.ofString(JsonOutput.toJson(body)))
        def response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString())
        cookies.cookieStore.cookies.each { it.version = 0 }
        [status: response.statusCode(), body: response.body() ? new JsonSlurper().parseText(response.body()) : null]
    }

    Map success(String method, String path, Object body = null, Map headers = [:]) {
        def response = request(method, path, body, headers)
        assert response.status == 200: "Expected success for ${method} ${path}, got ${response.status}: ${response.body}"
        response
    }

    void login() {
        success('POST', '/auth/login', [
            email: System.getenv('TEST_ADMIN_EMAIL'),
            password: System.getenv('TEST_ADMIN_PASSWORD')
        ])
    }
}
