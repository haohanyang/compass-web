const { OpenAI } = require('openai');
const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');

const openai = new OpenAI();

const SYSTEM_PROMPT = `
You are an expert in MongoDB query language (MQL). You will be given user's request and database schema from sampled documents.
You need to generate a syntactically correct query based on the them. The query will be used to execute the code \`db.collection.find(filter, options)\`.

Follow these rules when generating the query:
- Respond with error if user's request is not related to querying the MongoDB, or the request is about modifying the database (e.g., insert, update, delete).
- Respond with error if user's request is unclear, ambiguous, or cannot be answered using the provided schema.
- The error message should be displayed to the user as is, so make sure it is clear and concise without any format.
- Only set optional parameters (limit, project, skip, sort) if necessary.
`;

const USER_PROMPT = `
- Schema
{
    _id: { types: [{ bsonType: 'ObjectId' }] },
    score: { types: [{ bsonType: 'Int32' }] },
}
- Request
Find all documents where score is greater than 50.
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

export async function generateQuery({}) {
  const response = await openai.chat.completions.parse({
    model: 'gpt-5-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT.trim() },
      {
        role: 'user',
        content: USER_PROMPT.trim(),
      },
    ],
    response_format: zodResponseFormat(MongoQuery, 'query'),
  });

  return response.choices[0].message;
}
