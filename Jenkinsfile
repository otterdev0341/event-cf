pipeline {
    agent { label 'built-in' }
    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 20, unit: 'MINUTES')
    }
    triggers { pollSCM('H/5 * * * *') }
    environment {
        IMAGE_TAG = "jenkins-${BUILD_NUMBER}"
        DOCKER_CONFIG = '/var/jenkins_home/.docker'
        BUILDX_BUILDER = 'otter-shared-ci'
        DOCKER_BUILDKIT = '1'
        COMPOSE_PARALLEL_LIMIT = '1'
        DOCKER_LOCK_FILE = '/var/jenkins_home/shared-docker-daemon.lock'
    }
    stages {
        stage('Preflight') {
            steps {
                sh 'bash scripts/ci/capacity.sh --report-only'
                script {
                    def result = sh(returnStatus: true, script: 'flock -x "$DOCKER_LOCK_FILE" bash scripts/ci/cleanup.sh --apply')
                    if (result != 0) { echo "WARNING: preflight cleanup failed (${result})" }
                }
                sh 'bash scripts/ci/capacity.sh'
                sh 'for script in scripts/ci/*.sh; do bash -n "$script" || exit; done; git diff --check && docker compose config --quiet'
            }
        }
        stage('Build foundation') {
            steps {
                sh '''
                    flock -x "$DOCKER_LOCK_FILE" docker buildx build --builder otter-shared-ci \
                      --load --build-arg BUILD_REVISION="$GIT_COMMIT" \
                      --label ci.build="$BUILD_NUMBER" \
                      -f infra/Dockerfile -t "event-confirm/web:$IMAGE_TAG" .
                    docker run --rm --network none --cpus=.25 --memory=64m --memory-swap=64m \
                      --pids-limit=64 --label ci.project=event-confirm --label ci.purpose=validation \
                      "event-confirm/web:$IMAGE_TAG" nginx -t
                '''
            }
        }
        stage('Deploy foundation') {
            steps { sh 'flock -x "$DOCKER_LOCK_FILE" bash scripts/ci/deploy.sh' }
        }
        stage('Public smoke') {
            steps { sh 'bash scripts/ci/smoke.sh https://otterdev.xyz' }
        }
    }
    post {
        cleanup {
            script {
                def result = sh(returnStatus: true, script: 'flock -x "$DOCKER_LOCK_FILE" bash scripts/ci/cleanup.sh --apply')
                if (result != 0) { echo "WARNING: post-build cleanup failed (${result}); original build result preserved" }
            }
        }
    }
}
