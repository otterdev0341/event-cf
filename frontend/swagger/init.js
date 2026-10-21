window.addEventListener('load', () => {
  window.ui = SwaggerUIBundle({
    url: './openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    validatorUrl: null,
    supportedSubmitMethods: ['get', 'post', 'patch', 'delete'],
    requestInterceptor: request => {
      request.headers['X-Requested-With'] = 'EventConfirm';
      return request;
    },
    persistAuthorization: false,
  });
});
