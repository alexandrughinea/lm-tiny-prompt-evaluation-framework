import {CONFIGURATION} from '../src/config.js';
import OpenAIAdapter from '../src/adapters/openai.js';

async function testConnection() {
    const baseUrl = CONFIGURATION.modelServer.url;
    const modelId = CONFIGURATION.models.default[0] || 'default';

    console.log(`Testing connection to ${baseUrl}`);
    console.log(`Model: ${modelId} (normalized: ${OpenAIAdapter.getModelIdForFilePath(modelId)})`);

    try {
        const adapter = new OpenAIAdapter({baseUrl, model: modelId, max_tokens: 50});

        console.log('\nTesting models endpoint...');
        const modelsData = await adapter.listModels();
        console.log('Available models:', modelsData.data?.map(model => model.id).join(', ') || 'None found');
        console.log('✅ Models endpoint is working');

        console.log('\nTesting chat completions endpoint...');
        const chatData = await adapter.chat([{role: 'user', content: 'Hello'}], {max_tokens: 10});

        if (chatData.choices && chatData.choices?.length > 0) {
            const response = chatData.choices[0].message?.content || '';
            console.log('Response:', response.substring(0, 50) + (response?.length > 50 ? '...' : ''));
            console.log('✅ Chat completions endpoint is working');
        } else {
            console.error('❌ Chat completions returned an empty response');
        }

        console.log('\nConnection tests completed successfully.');
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\nConnection tests completed with errors.');
    }
}

testConnection().catch(error => {
    console.error('Fatal error:', error);
});
