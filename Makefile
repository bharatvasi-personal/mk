# Operations, in one place, so the non-DevOps partner can run them from a printed sheet.
.DEFAULT_GOAL := help
SHELL := /bin/bash
COMPOSE := docker compose -f infra/compose/docker-compose.yml --env-file .env
COMPOSE_PROD := docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.prod.yml --env-file .env

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ── Development ──────────────────────────────────────────────────────────────

.PHONY: setup
setup: ## First-time setup: deps, containers, schema, seed data
	@test -f .env || cp .env.example .env
	npm install
	npm run build -w @mk/shared
	$(COMPOSE) up -d
	@echo "waiting for postgres…"
	@until $(COMPOSE) exec -T postgres pg_isready -U $${POSTGRES_USER:-mk_owner} >/dev/null 2>&1; do sleep 1; done
	@$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-mk_owner} -d postgres \
		-c "CREATE DATABASE mithilakitchen_shadow" 2>/dev/null || true
	$(MAKE) db-setup
	@echo ""
	@echo "  Done. Run 'make dev', then:"
	@echo "    http://localhost:3000/en        public site"
	@echo "    http://localhost:3000/en/pos    counter  (owner@mithilakitchen.in / ChangeMe@12345)"
	@echo "    http://localhost:4000/api/docs  API reference"

.PHONY: dev
dev: ## Run the API and the website with hot reload
	npm run dev

.PHONY: up
up: ## Start Postgres, Redis and object storage
	$(COMPOSE) up -d

.PHONY: down
down: ## Stop the containers (data is kept)
	$(COMPOSE) down

.PHONY: logs
logs: ## Tail container logs
	$(COMPOSE) logs -f --tail=100

# ── Database ─────────────────────────────────────────────────────────────────

.PHONY: db-setup
db-setup: ## Migrate, apply RLS/triggers, and seed
	npm run db:migrate:deploy -w @mk/api
	npm run db:security -w @mk/api
	npm run db:seed -w @mk/api

.PHONY: db-migrate
db-migrate: ## Create and apply a new migration (asks for a name)
	npm run db:migrate -w @mk/api
	@echo "Re-applying security objects so any new table gets its RLS policy…"
	npm run db:security -w @mk/api

.PHONY: db-security
db-security: ## Re-apply roles, RLS policies and immutability triggers
	npm run db:security -w @mk/api

.PHONY: db-studio
db-studio: ## Browse the database
	cd apps/api && npx prisma studio

# ── Quality ──────────────────────────────────────────────────────────────────

.PHONY: check
check: ## Typecheck everything and run the unit tests
	npm run typecheck
	npm run test -w @mk/shared

.PHONY: test-e2e
test-e2e: ## Run the end-to-end smoke test against a running API
	node tests/smoke.mjs

.PHONY: build
build: ## Production build of every package
	npm run build

# ── Production ───────────────────────────────────────────────────────────────

.PHONY: deploy
deploy: ## Pull images, migrate, and restart (run on the server)
	$(COMPOSE_PROD) pull
	$(COMPOSE_PROD) run --rm api npm run db:migrate:deploy
	$(COMPOSE_PROD) run --rm api npm run db:security
	$(COMPOSE_PROD) up -d
	@sleep 5
	@curl -sf http://localhost/api/health/ready && echo "  healthy" || (echo "  UNHEALTHY"; exit 1)

.PHONY: backup
backup: ## Take a backup right now
	$(COMPOSE_PROD) exec backup /scripts/backup.sh

.PHONY: restore-verify
restore-verify: ## Restore the latest backup into a scratch database and check it
	$(COMPOSE_PROD) exec backup /scripts/restore-verify.sh

.PHONY: restore
restore: ## Restore over the LIVE database. FILE=... CONFIRM=yes
	@test -n "$(FILE)" || (echo "usage: make restore FILE=/backups/x.dump CONFIRM=yes"; exit 2)
	CONFIRM=$(CONFIRM) $(COMPOSE_PROD) exec -T backup /scripts/restore.sh "$(FILE)"
	$(MAKE) db-security

.PHONY: ps
ps: ## What is running
	$(COMPOSE_PROD) ps
