# Changed by Pralvo: adds the plugin, dev-db and ui targets. See docs/plugins.md.

BINARY=gatus

.PHONY: install
install:
	go build -v -o $(BINARY) .

.PHONY: run
run:
	ENVIRONMENT=dev GATUS_CONFIG_PATH=./config.yaml go run main.go

.PHONY: run-binary
run-binary:
	ENVIRONMENT=dev GATUS_CONFIG_PATH=./config.yaml ./$(BINARY)

.PHONY: clean
clean:
	rm $(BINARY)

.PHONY: plugin
plugin:
	go run ./plugin/cmd/newplugin $(NAME)

.PHONY: dev-db
dev-db:
	podman start pralvo-gatus-postgres 2>/dev/null || podman run -d --name pralvo-gatus-postgres -p 127.0.0.1:55432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=gatus_dev -v pralvo-gatus-pgdata:/var/lib/postgresql docker.io/library/postgres:18-alpine

.PHONY: test
test:
	go test ./... -cover


##########
# Docker #
##########

.PHONY: docker-build
docker-build:
	docker build -t twinproduction/gatus:latest .

.PHONY: docker-run
docker-run:
	docker run -p 8080:8080 --name gatus twinproduction/gatus:latest

.PHONY: docker-build-and-run
docker-build-and-run: docker-build docker-run


#############
# Front end #
#############

.PHONY: frontend-install
frontend-install:
	npm --prefix web/app install

.PHONY: frontend-build
frontend-build:
	npm --prefix web/app run build

.PHONY: frontend-dev
frontend-dev:
	npm --prefix web/app run serve

# web/ui is the React interface replacing web/app.
.PHONY: ui-install
ui-install:
	npm --prefix web/ui ci

.PHONY: ui-check
ui-check:
	npm --prefix web/ui run check
