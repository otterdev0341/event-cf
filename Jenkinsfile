pipeline {
    agent { label 'built-in' }
    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 40, unit: 'MINUTES')
    }
    triggers { pollSCM('H/5 * * * *') }
    environment {
        EVENT_CONFIRM_ENV_FILE = '/var/jenkins_home/event-confirm/runtime.env'
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
                sh 'for script in scripts/ci/*.sh; do bash -n "$script" || exit; done; git diff --check && docker compose --env-file "$EVENT_CONFIRM_ENV_FILE" config --quiet'
            }
        }
        stage('Frontend phase checks') {
            steps {
                sh 'flock -x "$DOCKER_LOCK_FILE" bash scripts/ci/frontend-container.sh'
            }
            post {
                always {
                    junit testResults: 'frontend/reports/*.xml', allowEmptyResults: currentBuild.currentResult == 'ABORTED'
                    archiveArtifacts artifacts: 'frontend/test-results/**/*,frontend/reports/*.xml', allowEmptyArchive: true
                }
            }
        }
        stage('Backend and Groovy acceptance') {
            steps {
                sh 'flock -x "$DOCKER_LOCK_FILE" bash scripts/ci/backend-container.sh'
            }
            post {
                always {
                    junit testResults: 'tests/api/build/test-results/test/*.xml,frontend/reports/backend-browser.xml', allowEmptyResults: currentBuild.currentResult == 'ABORTED'
                    archiveArtifacts artifacts: 'backend/reports/**/*,tests/api/build/reports/tests/**/*', allowEmptyArchive: true
                }
            }
        }
        stage('Build application images') {
            steps {
                sh '''
                    flock -x "$DOCKER_LOCK_FILE" docker buildx build --builder otter-shared-ci \
                      --load --build-arg BUILD_REVISION="$GIT_COMMIT" \
                      --label ci.build="$BUILD_NUMBER" \
                      -f infra/Dockerfile -t "event-confirm/web:$IMAGE_TAG" .
                    for component in api provider; do
                      file=infra/backend/runtime.Dockerfile
                      if [ "$component" = provider ]; then file=infra/backend/provider.Dockerfile; fi
                      flock -x "$DOCKER_LOCK_FILE" docker buildx build --builder otter-shared-ci \
                        --load --build-arg BUILD_REVISION="$GIT_COMMIT" --label ci.build="$BUILD_NUMBER" \
                        -f "$file" -t "event-confirm/$component:$IMAGE_TAG" .
                    done
                    docker run --rm --network none --cpus=.25 --memory=64m --memory-swap=64m \
                      --pids-limit=64 --label ci.project=event-confirm --label ci.purpose=validation \
                      "event-confirm/web:$IMAGE_TAG" nginx -t
                '''
            }
        }
        stage('Deploy integration workspace') {
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
