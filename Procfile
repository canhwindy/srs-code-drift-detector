web: yarn concurrently -n outline,filesplit -c "blue,green" "node ./build/server/index.js --services=web,websockets,collaboration" "npx dotenvx run -- dotnet run --project ./FileSplitApi/FileSplitApi.csproj"
worker: node ./build/server/index.js --services=worker
