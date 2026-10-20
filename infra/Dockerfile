FROM nginx:1.28-alpine
LABEL ci.project="event-confirm"
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision=$BUILD_REVISION
COPY frontend/dist/ /usr/share/nginx/html/event-confirm/
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i 's/worker_processes  auto;/worker_processes  1;/' /etc/nginx/nginx.conf
