const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');

// Configurar variáveis de ambiente ANTES de importar index.js
process.env.BUCKET_NAME = 'test-bucket';
process.env.AWS_ENDPOINT_URL_S3 = 'http://localhost:4566';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';

const { handler } = require('./index');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Apenas imagens são permitidas'), false);
        }
    }
});

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    console.log('Query params:', req.query);
    console.log('Path params:', req.params);
    next();
});

// rota para upload de imagem
app.post('/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'Nenhuma imagem foi enviada',
                message: 'Use o campo "image" para enviar uma imagem'
            });
        }

        const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

        const s3Client = new S3Client({
            endpoint: 'http://localhost:4566',
            forcePathStyle: true,
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test'
            }
        });

        const fileBuffer = fs.readFileSync(req.file.path);

        const fileName = req.body.name || req.file.originalname;

        // upload para S3 no diretório originals
        const putCommand = new PutObjectCommand({
            Bucket: 'test-bucket',
            Key: `originals/${fileName}`,
            Body: fileBuffer,
            ContentType: req.file.mimetype
        });

        await s3Client.send(putCommand);

        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            message: 'Imagem enviada com sucesso',
            fileName: fileName,
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            s3Key: `originals/${fileName}`,
            testUrl: `http://localhost:${PORT}/images/${fileName}?width=300`
        });

    } catch (error) {
        console.error('❌ Erro no upload:', error);

        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Erro ao limpar arquivo temporário:', unlinkError);
            }
        }

        res.status(500).json({
            error: 'Erro no upload da imagem',
            message: error.message
        });
    }
});

// rota para criar bucket (útil para setup inicial)
app.post('/setup', async (req, res) => {
    try {
        const { S3Client, CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

        const s3Client = new S3Client({
            endpoint: 'http://localhost:4566',
            forcePathStyle: true,
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test'
            }
        });

        try {
            await s3Client.send(new HeadBucketCommand({ Bucket: 'test-bucket' }));
            return res.json({
                success: true,
                message: 'Bucket já existe',
                bucketName: 'test-bucket'
            });
        } catch (error) {
        }

        const createCommand = new CreateBucketCommand({
            Bucket: 'test-bucket'
        });

        await s3Client.send(createCommand);

        res.json({
            success: true,
            message: 'Bucket criado com sucesso',
            bucketName: 'test-bucket'
        });

    } catch (error) {
        console.error('❌ Erro no setup:', error);
        res.status(500).json({
            error: 'Erro ao criar bucket',
            message: error.message
        });
    }
});

// rota principal p redimensionamento
app.get('/images/:image_name', async (req, res) => {
    try {
        const event = {
            pathParameters: {
                image_name: req.params.image_name
            },
            queryStringParameters: req.query || {}
        };

        console.log('📤 Evento simulado:', JSON.stringify(event, null, 2));

        // chamar handler Lambda
        const result = await handler(event);

        console.log('📥 Resultado:', JSON.stringify(result, null, 2));

        res.status(result.statusCode);

        // definir headers
        if (result.headers) {
            Object.keys(result.headers).forEach(header => {
                res.set(header, result.headers[header]);
            });
        }

        // Se for redirect, enviar location
        if (result.statusCode === 302) {
            return res.json({
                message: 'Redirect para imagem processada',
                location: result.headers.Location,
                statusCode: result.statusCode,
                cacheControl: result.headers['Cache-Control']
            });
        }

        if (result.body) {
            return res.send(result.body);
        }

        res.json({ success: true });

    } catch (error) {
        console.error('❌ Erro no servidor:', error);
        res.status(500).json({
            error: 'Erro interno do servidor',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: {
            BUCKET_NAME: process.env.BUCKET_NAME,
            AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL,
            AWS_REGION: process.env.AWS_REGION
        }
    });
});

// pota para listar buckets (debug)
app.get('/debug/buckets', async (req, res) => {
    try {
        const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');

        const s3Client = new S3Client({
            endpoint: 'http://localhost:4566',
            forcePathStyle: true,
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test'
            }
        });

        const command = new ListBucketsCommand({});
        const result = await s3Client.send(command);

        res.json({
            buckets: result.Buckets || [],
            count: result.Buckets?.length || 0
        });

    } catch (error) {
        res.status(500).json({
            error: 'Erro ao listar buckets',
            message: error.message
        });
    }
});

// rota para deletar bucket
app.delete('/bucket/:bucketName', async (req, res) => {
    try {
        const { S3Client, DeleteBucketCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');

        const s3Client = new S3Client({
            endpoint: 'http://localhost:4566',
            forcePathStyle: true,
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test'
            }
        });

        const bucketName = req.params.bucketName;

        const listCommand = new ListObjectsV2Command({
            Bucket: bucketName
        });

        const listResult = await s3Client.send(listCommand);

        if (listResult.Contents && listResult.Contents.length > 0) {
            for (const object of listResult.Contents) {
                const deleteObjectCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: object.Key
                });
                await s3Client.send(deleteObjectCommand);
            }
        }

        const deleteBucketCommand = new DeleteBucketCommand({
            Bucket: bucketName
        });

        await s3Client.send(deleteBucketCommand);

        res.json({
            success: true,
            message: `Bucket '${bucketName}' e todos os seus objetos foram deletados`,
            bucketName: bucketName,
            objectsDeleted: listResult.Contents?.length || 0
        });

    } catch (error) {
        console.error('❌ Erro ao deletar bucket:', error);
        res.status(500).json({
            error: 'Erro ao deletar bucket',
            message: error.message
        });
    }
});

// rota para listar objetos em um bucket (debug)
app.get('/debug/bucket/:bucketName', async (req, res) => {
    try {
        const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

        const s3Client = new S3Client({
            endpoint: 'http://localhost:4566',
            forcePathStyle: true,
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test'
            }
        });

        const command = new ListObjectsV2Command({
            Bucket: req.params.bucketName
        });

        const result = await s3Client.send(command);

        res.json({
            bucket: req.params.bucketName,
            objects: result.Contents || [],
            count: result.Contents?.length || 0
        });

    } catch (error) {
        res.status(500).json({
            error: 'Erro ao listar objetos',
            message: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`
🚀 SERVIDOR POSTMAN INICIADO
============================

📡 URL Base: http://localhost:${PORT}
🌐 Frontend: http://localhost:${PORT}

🧪 Endpoints para testar no Postman:

1. 📊 Health Check:
   GET http://localhost:${PORT}/health

2. 🔧 Setup Inicial (criar bucket):
   POST http://localhost:${PORT}/setup

3. 📤 Upload de Imagem:
   POST http://localhost:${PORT}/upload
   Body: form-data
   - Key: image (type: File)
   - Key: name (type: Text, opcional - nome customizado)

4. 🖼️  Redimensionar Imagem:
   GET http://localhost:${PORT}/images/test.jpg?width=300
   GET http://localhost:${PORT}/images/test.jpg?height=200
   GET http://localhost:${PORT}/images/test.jpg?width=400&height=300

5. 🔍 Debug - Listar Buckets:
   GET http://localhost:${PORT}/debug/buckets

6. 🗂️  Debug - Objetos no Bucket:
   GET http://localhost:${PORT}/debug/bucket/test-bucket

⚠️  Certifique-se de que LocalStack está rodando:
   docker compose -f docker-compose.test.yml up -d
`);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada:', reason);
});