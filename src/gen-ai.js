const { OpenAI } = require('openai');
const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');

const QUERY_SYSTEM_PROMPT = `
You are an expert in MongoDB query language (MQL). You will be given user's request, collection name and schema from sampled documents.
You need to generate a syntactically correct query based on the them. The query will be used to execute the code \`db.collection.find(filter, options)\`.

Follow these rules when generating the query:
- Respond with error if user's request is not related to querying the MongoDB, or the request is about modifying the database (e.g., insert, update, delete).
- Respond with error if user's request is unclear, ambiguous, or cannot be answered using the provided schema.
- The error message should be displayed to the user as is, so make sure it is clear and concise without any format.
- Only set optional parameters (limit, project, skip, sort) if necessary.
`;

const AGGREGATION_SYSTEM_PROMPT = `
You are an expert in MongoDB query language (MQL). You will be given user's request, collection name and schema from sampled documents.
You need to generate a syntactically correct aggregation pipeline based on the them. The query will be used to execute the code \`db.collection.aggregate(pipeline)\`.

Follow these rules when generating the pipeline:
- Respond with error if user's request is not related to querying the MongoDB, or the request is about modifying the database (e.g., insert, update, delete).
- Respond with error if user's request is unclear, ambiguous, or cannot be answered using the provided schema.
- The error message should be displayed to the user as is, so make sure it is clear and concise without any format.
`;

const MongoQuery = z.object({
  filter: z.string({
    description: 'Valid MongoDB query filter, e.g. { age: { $gt: 25 } }.',
  }),
  limit: z
    .number({
      description: 'Limit of documents returned.',
    })
    .nullable(),
  project: z
    .string({
      description: 'Projection fields, e.g. { name: 1, age: 1 }.',
    })
    .nullable(),
  skip: z
    .number({
      description: 'Number of documents to skip.',
    })
    .nullable(),
  sort: z
    .string({
      description: 'Sort order, e.g. { age: -1 }.',
    })
    .nullable(),
  error: z
    .string({
      description: 'Error message if the query cannot be generated.',
    })
    .nullable(),
});

const MongoAggregation = z.object({
  pipeline: z.string({
    description:
      'Valid MongoDB aggregation pipeline consisting of stages, e.g. [{ $match: { age: { $gt: 25 } } }].',
  }),

  error: z
    .string({
      description:
        'Error message if the aggregation pipeline cannot be generated.',
    })
    .nullable(),
});

async function generateQuery(
  apiKey,
  { userInput, collectionName, databaseName, schema }
) {
  if (!userInput) {
    throw new Error('User input is required to generate a query.');
  }

  if (!collectionName) {
    throw new Error('Collection name is required to generate a query.');
  }

  if (!schema) {
    throw new Error('Schema is required to generate a query.');
  }

  const openai = new OpenAI({ apiKey });

  const userPrompt = `
- Collection name:
${collectionName}
- Schema:
${JSON.stringify(schema, null, 2)}
- Request:
${userInput.trim()}
`;
  const response = await openai.chat.completions.parse({
    model: 'gpt-5-mini',
    messages: [
      { role: 'system', content: QUERY_SYSTEM_PROMPT.trim() },
      {
        role: 'user',
        content: userPrompt.trim(),
      },
    ],
    response_format: zodResponseFormat(MongoQuery, 'query'),
  });

  const message = response.choices[0].message;
  console.log('Raw response message:', message);

  if (message.refusal) {
    throw new Error(message.refusal);
  }

  // Post-process the response
  const content = message.parsed;

  if (content.error?.trim()) {
    throw new Error(content.error?.trim());
  }

  if (content.limit === 0) {
    content.limit = null;
  }

  if (content.skip === 0) {
    content.skip = null;
  }

  if (!content.project || content.project.trim() === '{}') {
    content.project = null;
  }

  if (!content.sort || content.sort.trim() === '{}') {
    content.sort = null;
  }

  return content;
}

async function generateAggregation(
  apiKey,
  { userInput, collectionName, databaseName, schema }
) {
  if (!userInput) {
    throw new Error(
      'User input is required to generate an aggregation pipeline.'
    );
  }

  if (!collectionName) {
    throw new Error(
      'Collection name is required to generate an aggregation pipeline'
    );
  }

  if (!schema) {
    throw new Error('Schema is required to generate an aggregation pipeline.');
  }

  const openai = new OpenAI({ apiKey });

  const userPrompt = `
- Collection name:
${collectionName}
- Schema:
${JSON.stringify(schema, null, 2)}
- Request:
${userInput.trim()}
`;
  const response = await openai.chat.completions.parse({
    model: 'gpt-5-mini',
    messages: [
      { role: 'system', content: AGGREGATION_SYSTEM_PROMPT.trim() },
      {
        role: 'user',
        content: userPrompt.trim(),
      },
    ],
    response_format: zodResponseFormat(MongoAggregation, 'aggregation'),
  });

  const message = response.choices[0].message;
  console.log('Raw response message:', message);

  if (message.refusal) {
    throw new Error(message.refusal);
  }

  // Post-process the response
  const content = message.parsed;

  if (content.error?.trim()) {
    throw new Error(content.error?.trim());
  }

  return content;
}

if (require.main === module) {
  process.loadEnvFile();

  Promise.allSettled([
    generateQuery(process.env.OPENAI_API_KEY, {
      schema: {
        _id: { types: [{ bsonType: 'ObjectId' }] },
        score: { types: [{ bsonType: 'Int32' }] },
      },
      userInput: 'Delete all documents where score is greater than 50.',
      databaseName: 'testDB',
      collectionName: 'testCollection',
    }),
    generateAggregation(process.env.OPENAI_API_KEY, {
      schema: {
        _id: { types: [{ bsonType: 'ObjectId' }] },
        score: { types: [{ bsonType: 'Int32' }] },
      },
      userInput: 'Find all documents where score is greater than 50.',
      databaseName: 'testDB',
      collectionName: 'testCollection',
    }),
  ]).then(([queryResult, pipelineResult]) => {
    if (queryResult.status === 'rejected') {
      console.error('Query Generation Error:', queryResult.reason);
    } else {
      console.log('Generated Query Result:', queryResult.value);
    }

    if (pipelineResult.status === 'rejected') {
      console.error('Pipeline Generation Error:', pipelineResult.reason);
    } else {
      console.log('Generated Pipeline Result:', pipelineResult.value);
    }
  });
}

module.exports = { generateQuery, generateAggregation };
