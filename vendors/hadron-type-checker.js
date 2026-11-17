const { BSON } = require('mongodb');

function getBsonType(value) {
  if (value == null || !BSON.bsonType) {
    return undefined;
  }
  return value[BSON.bsonType];
}

module.exports = { getBsonType };
