const cron = require('node-cron');
const axios = require('axios');
const OpenAI = require('openai');
const crypto = require('crypto');
const fs = require('fs');
const mime = require('mime-types');
const formData = require('form-data');

require('dotenv').config();

function getHash(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha1');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

function updateImagesList() {
    let imagesList = [];
    if (fs.existsSync('./images.json')) {
        imagesList = JSON.parse(fs.readFileSync('./images.json', 'utf8'));
    }
    const images = fs.readdirSync('./images');

    const newImages = images.filter(image => {
        const imagePath = `./images/${image}`;
        const imageSize = fs.statSync(imagePath).size;
        const mimeType = mime.lookup(imagePath);
        return (
            mimeType &&
            mimeType.startsWith('image/') &&
            !imagesList.some(
                img =>
                    img.filename === image &&
                    img.filesize === imageSize &&
                    img.hash === getHash(imagePath)
            ) &&
            imageSize < 8 * 1024 * 1024
        );
    });

    const removedImages = imagesList.filter(
        image => !images.includes(image.filename)
    );

    removedImages.forEach(image => {
        imagesList.splice(imagesList.indexOf(image), 1);
    });

    newImages.forEach(image => {
        const imagePath = `./images/${image}`;
        imagesList.push({
            id: imagesList.length + 1,
            filename: image,
            hash: getHash(imagePath),
            filesize: fs.statSync(`./images/${image}`).size,
            cooldown: 0
        });
    });

    fs.writeFileSync('./images.json', JSON.stringify(imagesList, null, 2));
}

async function callOpenAI(model, prompt, includeImage, imagePath) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not defined');
    }

    const openAiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    let response;
    if (includeImage && imagePath) {
        const imageBuffer = fs.readFileSync(imagePath);
        const encodedImage = imageBuffer.toString('base64');
        response = await openAiClient.chat.completions.create({
            model: model,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: prompt,
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/jpeg;base64,${encodedImage}`,
                            },
                        },
                    ],
                },
            ],
            max_tokens: 1000,
        });
    } else {
        response = await openAiClient.chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1000,
        });
    }

    if ('choices' in response) {
        const choice = response.choices[0];
        if ('text' in choice) {
            return choice.text;
        } else if ('message' in choice && choice.message.content !== null) {
            return choice.message.content;
        } else {
            throw new Error('Unexpected response format');
        }
    } else {
        throw new Error('Unexpected response format');
    }
}

async function replacePlaceholders(content, imagePath) {
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date();
    const replacements = {
        '%timestamp%': timestamp.toString(),
        '%date%': date.toDateString(),
        '%time%': date.toTimeString(),
    };

    const openAiPlaceholderRegex = /%openai::([^:]+)::([^:]+)(::(true|false))?%/g;
    const matches = [...content.matchAll(openAiPlaceholderRegex)];

    for (const match of matches) {
        const [placeholder, model, prompt, , includeImage] = match;
        const includeImageBool = includeImage === 'true';
        const openAiResponse = await callOpenAI(model, prompt, includeImageBool, imagePath);
        content = content.replace(placeholder, openAiResponse);
    }

    return content.replace(/%\w+%/g, (match) => replacements[match] || match);
}

const cronSchedule = process.env.CRON_SCHEDULE;
if (!cronSchedule) {
    throw new Error('CRON_SCHEDULE is not defined');
}

cron.schedule(cronSchedule, async () => {
    console.log('Running the main function');
    await main();
});

async function main() {
    console.log('Starting the main function');
    updateImagesList();

    if (fs.readdirSync('./images').length === 0) {
        throw new Error('No images found in the images folder');
    } else if (!fs.existsSync('./images.json')) {
        throw new Error('No images.json file found');
    } else if (
        JSON.parse(fs.readFileSync('./images.json', 'utf8')).length === 0
    ) {
        throw new Error('No images metadata found in the images.json file');
    } else if (
        JSON.parse(fs.readFileSync('./images.json', 'utf8')).every(
            image => image.cooldown > 0
        ) &&
        process.env.SEND_IF_ALL_IMAGES_HAVE_COOLDOWN &&
        process.env.SEND_IF_ALL_IMAGES_HAVE_COOLDOWN === 'false'
    ) {
        throw new Error('All images have cooldown');
    }

    if (!process.env.DISCORD_WEBHOOK_URL || typeof process.env.DISCORD_WEBHOOK_URL !== 'string') {
        throw new Error('DISCORD_WEBHOOK_URL is not defined');
    }

    const imagesList = JSON.parse(fs.readFileSync('./images.json', 'utf8'));

    let image = null;
    while (!image) {
        let toBeSelected = null;
        if (
            JSON.parse(fs.readFileSync('./images.json', 'utf8')).every(
                image => image.cooldown > 0
            )
        ) {
            toBeSelected = Math.min(...imagesList.map(image => image.cooldown));
        } else {
            toBeSelected = imagesList[Math.floor(Math.random() * imagesList.length)];
            if (toBeSelected.cooldown !== 0) {
                continue;
            }
        }

        const imagePath = `./images/${toBeSelected.filename}`;
        const mimeType = mime.lookup(imagePath);
        if (
            !fs.existsSync(imagePath) ||
            toBeSelected.hash !== getHash(imagePath) ||
            toBeSelected.filesize > 8 * 1024 * 1024 ||
            !mimeType ||
            !mimeType.startsWith('image/')
        ) {
            imagesList.splice(imagesList.indexOf(toBeSelected), 1);
            fs.writeFileSync('./images.json', JSON.stringify(imagesList, null, 2));
            continue;
        }

        image = toBeSelected;
    }

    try {
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        const file = fs.createReadStream(`./images/${image.filename}`);

        const form = new formData();
        form.append('attachments', file);
        const messageContent = await replacePlaceholders(
            (process.env.MESSAGE_CONTENT || ``).replace(/\\n/g, '\n'),
            `./images/${image.filename}`
        );
        form.append('content', messageContent);

        axios.post(webhookUrl, form, {
            headers: {
            ...form.getHeaders(),
            },
        })
        .then(() => {
            console.log('Message sent');
            imagesList.forEach(img => {
                if (img.cooldown > 0) {
                    img.cooldown -= 1;
                }
            });

            const index = imagesList.indexOf(image);
            imagesList[index].cooldown = parseInt(process.env.IMAGE_REPEAT_COOLDOWN || '0');
            fs.writeFileSync('./images.json', JSON.stringify(imagesList, null, 2));
        })
        .catch((error) => {
            console.error('Error sending message: ', error);
        });

    } catch (e) {
        console.error(e);
    }
}

main();