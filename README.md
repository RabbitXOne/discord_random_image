A friend asked me to make a project that sends a random image to Discord channel every hour/day/etc. (its customizable through .env file) 🙃

You have to add images you want to be sent to images/ folder.

## .env file
CRON_SCHEDULE= regular cron schedule config value like: 20 11 * * 4 (every TThursday at 11:20)
IMAGE_REPEAT_COOLDOWN= number which indicates how much images need to be sent before the same image is being sent again
SEND_IF_ALL_IMAGES_HAVE_COOLDOWN= if all images have some cooldown apply and this value is set to true, an image with the lowest cooldown value will be sent; otherwise the app will just crash
DISCORD_WEBHOOK_URL=
OPENAI_API_KEY= optional, enter key here is you want to add ChatGPT text to the message
MESSAGE_CONTENT= enter the message content you want to include along with the image here; this field supports also a few placeholders:

%timestamp% will return UNIX timestamp of the time of script execution, so you can do for eg. <t:%timestamp%:R>
%time% will return current time
%date% will return current date
Insert `\n` to start a new line

%openai::argument1::argument2% OR %openai::argument1::argument2::argument3%
1st argument is OpenAI's model name
2nd is the prompt
3rd is optional and if it's set to `true`, it'll include the image that's going to be sent on Discord with the prompt