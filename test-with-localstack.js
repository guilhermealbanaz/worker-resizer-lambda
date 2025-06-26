const { S3Client, CreateBucketCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');

process.env.BUCKET_NAME = 'test-bucket';
process.env.AWS_ENDPOINT_URL_S3 = 'http://localhost:4566';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';

const { handler } = require('./index');

// cliente S3 configurado para LocalStack
const s3Client = new S3Client({
    endpoint: 'http://localhost:4566',
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test'
    }
});

async function setupLocalStack() {
    const bucketName = 'test-bucket';

    try {
        await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
        console.log(`bucket ${bucketName} criado`);

        const testImage = fs.readFileSync('./test-images/test.jpg');
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: 'originals/test.jpg',
            Body: testImage,
            ContentType: 'image/jpeg'
        }));
        console.log('upload feito');

        console.log('LocalStack setup complete');
    } catch (error) {
        console.error('Setup error:', error);
        throw error;
    }
}

async function testWithLocalStack() {
    try {

        const event = {
            pathParameters: { image_name: 'test.jpg' },
            queryStringParameters: { width: '300' }
        };

        console.log('tentando fazer resize...');
        const result = await handler(event);
        console.log('resuldtado', result);

        if (result.statusCode === 302) {
            console.log('Successo');
        }

        // testar cache - segunda chamada
        console.log('\n testando cache (segunda chamada)...');
        const result2 = await handler(event);
        console.log('resultado', result2);

        if (result2.statusCode === 302) {
            console.log('Sucesso');
        }
    } catch (error) {
        console.error('Erro:', error);
    }
}

async function runTests() {
    await setupLocalStack();
    await testWithLocalStack();
}

runTests().catch(console.error);