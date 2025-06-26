const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

// configurar S3Client para usar LocalStack se disponível
const s3ClientConfig = { region: process.env.AWS_REGION || 'us-east-1' };

if (process.env.AWS_ENDPOINT_URL || process.env.AWS_ENDPOINT_URL_S3) {
    s3ClientConfig.endpoint = process.env.AWS_ENDPOINT_URL || process.env.AWS_ENDPOINT_URL_S3;
    s3ClientConfig.forcePathStyle = true;
    s3ClientConfig.credentials = {
        accessKeyId: 'test',
        secretAccessKey: 'test'
    };
}

const s3Client = new S3Client(s3ClientConfig);
const BUCKET_NAME = process.env.BUCKET_NAME || '';
const MAX_WIDTH = 2000;
const MAX_HEIGHT = 2000;

exports.handler = async (event) => {
    try {
        const imageName = event.pathParameters?.image_name;
        if (!imageName) {
            return createErrorResponse(400, 'nome é requerido');
        }

        const width = parseInt(event.queryStringParameters?.width) || null;
        const height = parseInt(event.queryStringParameters?.height) || null;

        if (width && (width > MAX_WIDTH || width < 1)) {
            return createErrorResponse(400, `${MAX_WIDTH}`);
        }
        if (height && (height > MAX_HEIGHT || height < 1)) {
            return createErrorResponse(400, `${MAX_HEIGHT}`);
        }

        if (!width && !height) {
            return createRedirectResponse(`https://${BUCKET_NAME}.s3.amazonaws.com/originals/${imageName}`);
        }

        const resizedKey = generateResizedKey(imageName, width, height);

        const cachedImage = await checkIfExists(resizedKey);
        if (cachedImage) {
            return createRedirectResponse(`https://${BUCKET_NAME}.s3.amazonaws.com/${resizedKey}`);
        }

        const originalImage = await getOriginalImage(imageName);
        if (!originalImage) {
            return createErrorResponse(404, 'imagem nao encontrada');
        }

        const resizedBuffer = await resizeImage(originalImage, width, height);

        await saveResizedImage(resizedKey, resizedBuffer);

        return createRedirectResponse(`https://${BUCKET_NAME}.s3.amazonaws.com/${resizedKey}`);

    } catch (error) {
        console.error('Erro:', error);
        return createErrorResponse(500, 'Internal server error');
    }
};

async function checkIfExists(key) {
    try {
        await s3Client.send(new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key
        }));
        return true;
    } catch (error) {
        return false;
    }
}

async function getOriginalImage(imageName) {
    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `originals/${imageName}`
        });

        const response = await s3Client.send(command);
        const chunks = [];

        for await (const chunk of response.Body) {
            chunks.push(chunk);
        }

        return Buffer.concat(chunks);
    } catch (error) {
        console.error('erro ao pegar imagem original:', error);
        return null;
    }
}

async function resizeImage(buffer, width, height) {
    const image = sharp(buffer);

    const resizeOptions = {};
    if (width) resizeOptions.width = width;
    if (height) resizeOptions.height = height;

    if (!width || !height) {
        resizeOptions.fit = 'inside';
        resizeOptions.withoutEnlargement = true;
    }

    return await image
        .resize(resizeOptions)
        .toBuffer();
}

async function saveResizedImage(key, buffer) {
    const metadata = await sharp(buffer).metadata();

    await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: `image/${metadata.format}`,
        CacheControl: 'public, max-age=31536000'
    }));
}

function generateResizedKey(imageName, width, height) {
    const dimensions = [];
    if (width) dimensions.push(`${width}w`);
    if (height) dimensions.push(`${height}h`);

    const dimensionString = dimensions.join('x');
    return `resized/${dimensionString}/${imageName}`;
}

function createRedirectResponse(location) {
    return {
        statusCode: 302,
        headers: {
            'Location': location,
            'Cache-Control': 'public, max-age=3600'
        }
    };
}

function createErrorResponse(statusCode, message) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: message })
    };
}