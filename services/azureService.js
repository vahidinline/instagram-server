const { AzureOpenAI } = require('openai');
const { AzureKeyCredential } = require('@azure/core-auth');
const { SearchIndexClient, SearchClient } = require('@azure/search-documents');
const crypto = require('crypto'); // <--- این خط حیاتی است

// *** لاگ جدید برای اطمینان از آپدیت شدن ***
console.log('🟣 AZURE SERVICE v4 - CRYPTO FIXED LOADED');

// --- CONFIGURATION ---
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_KEY;
const apiVersion = '2024-05-01-preview';
const chatDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_CHAT;
const embeddingDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_EMBEDDING;

const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
const searchKey = process.env.AZURE_SEARCH_KEY;
const indexName = process.env.AZURE_SEARCH_INDEX_NAME || 'knowledge-base-index';

if (!endpoint || !apiKey || !searchEndpoint || !searchKey) {
  console.error('❌ MISSING AZURE CONFIG in .env');
}

const openai = new AzureOpenAI({
  endpoint,
  apiKey,
  apiVersion,
});

const searchIndexClient = new SearchIndexClient(
  searchEndpoint,
  new AzureKeyCredential(searchKey)
);
const searchClient = new SearchClient(
  searchEndpoint,
  indexName,
  new AzureKeyCredential(searchKey)
);

const azureService = {
  ensureIndexExists: async () => {
    try {
      await searchIndexClient.getIndex(indexName);
    } catch (e) {
      console.log('⚠️ Index not found. Creating new index...');
      const indexObj = {
        name: indexName,
        fields: [
          { name: 'id', type: 'Edm.String', key: true, filterable: true },
          { name: 'content', type: 'Edm.String', searchable: true },
          { name: 'ig_accountId', type: 'Edm.String', filterable: true },
          { name: 'title', type: 'Edm.String', searchable: true },
          {
            name: 'contentVector',
            type: 'Collection(Edm.Single)',
            searchable: true,
            vectorSearchDimensions: 1536,
            vectorSearchProfileName: 'my-vector-profile',
          },
        ],
        vectorSearch: {
          algorithms: [{ name: 'my-hnsw-algo', kind: 'hnsw' }],
          profiles: [
            {
              name: 'my-vector-profile',
              algorithmConfigurationName: 'my-hnsw-algo',
            },
          ],
        },
      };
      await searchIndexClient.createIndex(indexObj);
      console.log('✅ Azure Search Index Created.');
    }
  },

  getEmbedding: async (text) => {
    try {
      const response = await openai.embeddings.create({
        input: text,
        model: embeddingDeployment,
      });
      return response.data[0].embedding;
    } catch (e) {
      console.error('Embedding Error:', e.message);
      throw e;
    }
  },

  addDocument: async (igAccountId, title, content) => {
    try {
      await azureService.ensureIndexExists();
      const vector = await azureService.getEmbedding(content);

      // استفاده از crypto
      const docId = crypto.randomBytes(16).toString('hex');

      const documents = [
        {
          id: docId,
          content: content,
          title: title,
          ig_accountId: igAccountId,
          contentVector: vector,
        },
      ];

      await searchClient.uploadDocuments(documents);
      console.log(`✅ Document indexed for ${igAccountId}`);
      return true;
    } catch (e) {
      console.error('Indexing Error:', e.message);
      return false;
    }
  },

  askAI: async (
    igAccountId,
    userQuery,
    systemInstruction = 'You are a helpful assistant.'
  ) => {
    try {
      const queryVector = await azureService.getEmbedding(userQuery);

      const searchResults = await searchClient.search(userQuery, {
        vectorQueries: [
          {
            vector: queryVector,
            k: 3,
            fields: ['contentVector'],
            kind: 'vector',
          },
        ],
        filter: `ig_accountId eq '${igAccountId}'`,
        select: ['content'],
      });

      let context = '';
      for await (const result of searchResults.results) {
        context += result.document.content + '\n---\n';
      }

      const response = await openai.chat.completions.create({
        model: chatDeployment,
        messages: [
          {
            role: 'system',
            content: `${systemInstruction}\n\nContext:\n${context}`,
          },
          { role: 'user', content: userQuery },
        ],
        temperature: 0.5,
      });

      return response.choices[0].message.content;
    } catch (e) {
      console.error('AI Generation Error:', e.message);
      return 'خطایی در پردازش هوشمند رخ داد.';
    }
  },
};

module.exports = azureService;
