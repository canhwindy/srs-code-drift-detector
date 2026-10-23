up:
	docker compose up -d redis postgres
	yarn install-local-ssl
	yarn install --immutable
	yarn dev:watch

up-all:
	docker compose up -d redis postgres
	yarn install-local-ssl
	yarn install --immutable
	yarn concurrently -n outline,filesplit -c "blue,green" "yarn dev:watch" "npx dotenvx run -- dotnet run --project ./FileSplitApi/FileSplitApi.csproj"

build:
	docker compose build --pull outline

test:
	docker compose up -d postgres
	NODE_ENV=test yarn sequelize db:drop
	NODE_ENV=test yarn sequelize db:create
	NODE_ENV=test yarn sequelize db:migrate
	yarn test

watch:
	docker compose up -d redis postgres
	NODE_ENV=test yarn sequelize db:drop
	NODE_ENV=test yarn sequelize db:create
	NODE_ENV=test yarn sequelize db:migrate
	yarn test:watch

destroy:
	docker compose stop
	docker compose rm -f

.PHONY: up up-all build destroy test watch # let's go to reserve rules names
