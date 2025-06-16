# MongoDB Compass Web

![npm](https://img.shields.io/npm/v/compass-web.svg)
![downloads](https://img.shields.io/npm/dw/compass-web)

A port of the MongoDB Compass to Web. The frontend is rebuilt and re-packaged from the original [@mongodb-js/compass-web](https://www.npmjs.com/package/@mongodb-js/compass-web). It provides an easy way to view and interact with your databases from a browser, while keeping most of the MongoDB Compass features.

## ![screenshot1](/images/screenshot1.png)

## 📦 Installation

Install `compass-web` npm package or pull Docker image `haohanyang/compass-web`

```bash
npm install compass-web -g
```

```bash
docker pull haohanyang/compass-web
```

## 🧭 Usage

Start the server with MongoDB connection string(s). The parameters are configured via program arguments or environment variables.

```bash
compass-web --mongo-uri "mongodb://localhost:27017"

# or configure via CW_MONGO_URI environment variable
CW_MONGO_URI="mongodb://localhost:27017" compass-web

# or use npx
npx compass-web --mongo-uri "mongodb://localhost:27017"

# multiple connection strings
compass-web --mongo-uri "mongodb://localhost:27017 mongodb+srv://myusername:secrets@default-cluster.mongodb.net/?retryWrites=true&w=majority&appName=default-cluster"
```

Use Docker:

```
docker run -it -p 8080:8080 -e CW_MONGO_URI="mongodb://localhost:27017" haohanyang/compass-web

```

Check an example [docker-compose.yaml](./docker-compose.yaml) file if you want to use Docker Compose.

## ⚙️ CLI Parameters

You can configure `compass-web` using command-line arguments or environment variables (prefixed with `CW_`).

| Parameter      | Type   | Env Variable    | Description                                                                         | Default              |
| -------------- | ------ | --------------- | ----------------------------------------------------------------------------------- | -------------------- |
| `--mongo-uri`  | string | `CW_MONGO_URI`  | **Required.** MongoDB connection string(s). Separate multiple URIs with whitespace. | _Required_           |
| `--port`       | number | `CW_PORT`       | Port to run the server on.                                                          | `8080`               |
| `--host`       | string | `CW_HOST`       | Host to run the server on.                                                          | `localhost`          |
| `--org-id`     | string | `CW_ORG_ID`     | Organization ID associated with the connection.                                     | `default-org-id`     |
| `--project-id` | string | `CW_PROJECT_ID` | Project ID associated with the connection.                                          | `default-project-id` |
| `--cluster-id` | string | `CW_CLUSTER_ID` | Cluster ID associated with the connection.                                          | `default-cluster-id` |

## Build

Clone the repo and fetch the upstream dependency [compass](https://github.com/mongodb-js/compass)

```bash
git clone https://github.com/haohanyang/compass-web.git
cd compass-web && git submodule update --init --recursive --single-branch --depth 1
```

Build the dependencies

```bash
bash bootstrap.sh
pnpm i --frozen-lockfile
```

Build the front end.

```bash
pnpm run build
```

Start the app

```bash
node app.js --mongo-uri "mongodb://localhost:27017"
```

## Credits

[MongoDB Compass](https://github.com/mongodb-js/compass)

## License

[Server Side Public License](/LICENSE)
