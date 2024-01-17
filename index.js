import express from "express";
import bodyParser from "body-parser";
import Mailjet from 'node-mailjet';
import pg from "pg";
import multer from "multer"; // Import multer
import xlsx from "xlsx";
import dotenv from 'dotenv';
dotenv.config();

const mailjet = Mailjet.apiConnect( 
    process.env.MJ_APIKEY_PUBLIC,
    process.env.MJ_APIKEY_PRIVATE,
);

// Multer setup
const storage = multer.memoryStorage(); // Store the file in memory
const upload = multer({ storage: storage });
multer({
    limits: { fieldSize: 1000 * 1024 * 1024 }  //1GB
  })

//Postgresql
const db = new pg.Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});


db.connect();

//app set up
const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true })); // for handling form data
app.use(bodyParser.json()); // for handling JSON data
app.use(express.static("public"));



//Endpoints
app.get("/", async (req, res) => {
    res.render("main.ejs");
});

    
app.post("/compose_email", async (req, res) => {
    res.render("compose.ejs");
});

app.post("/send_email", upload.single("excelFile"), async (req, res) => {
    try {
        const uploadedFile = req.file.buffer;
        const subject = req.body.subject;
        const htmlPart = req.body.modifiedHtmlContent;
        const imageDataArray = JSON.parse(req.body.imageDataArray);
        const status = req.body.status;

        await process_contact_file(uploadedFile, subject, htmlPart, imageDataArray, status);

        res.redirect("/");

    } catch (err) {
        console.error("Error in /send_email endpoint:", err);
        res.status(500).send('An error occurred while sending the email');
    }
});

//Process Customer Contact File
async function process_contact_file(uploadedFile, subject, htmlPart, imageDataArray, status)
{

    try {
        let base64content = "";
        if(imageDataArray.length > 0)
        {
            base64content = imageDataArray[0].Base64Content;
        }
        const workbook = xlsx.read(uploadedFile);
        const workbook_sheet = workbook.SheetNames;
        const workbook_response = xlsx.utils.sheet_to_json(
            workbook.Sheets[workbook_sheet[0]]
        );

        //Insert email
        await insertEmailTable(status);

        //Get current email id
        const emailID = await getCurrentEmailId();

        //Insert email_content
        await insertEmailContentTable(emailID, subject, htmlPart, base64content);


        for (const row of workbook_response) {
            const name = row['Full Name'];
            const recipientEmail = row['Email'];

            //Insert customers' contacts
            await insertCustomerContact(name, recipientEmail);
            if(status === 'sent')
            {
                await process_email(emailID, name, recipientEmail, subject, htmlPart, imageDataArray);
            }
            else
            {
                console.log("Email was saved");
                await insertRecordTable(recipientEmail, emailID);

            }
        }

    } catch (err) {
        console.error("Error processing the uploaded file:", err);
    }
}


async function process_email(emailID, recipientName, recipientEmail, subject, html_part, imageDataArray) {
    try {
        let message = {
            From: {
                Email: process.env.SENDER_EMAIL,
                Name: "BET Club",
            },
            To: [
                {
                    Email: recipientEmail,
                },
            ],
            "Subject": subject,
            "HTMLPart": `<h3> Dear ${recipientName},</h3> </br> ${html_part}`,
        };

        if (imageDataArray.length > 0) {
            message["InlinedAttachments"] = imageDataArray;
        }

        //Send email

        const request = mailjet
            .post("send", { version: "v3.1" })
            .request({
                Messages: [message],
            });

        request
            .then((result) => {
                console.log(result.body);
            })
            .catch((err) => {
                console.log("Could not send email");
                throw err;
            });
        
        //Insert record table
        await insertRecordTable(recipientEmail, emailID);

    } catch (err) {
        console.error("Error in process_email function:", err);
        throw err;
    }
}

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
  


async function insertEmailTable(status)
{
    try {
        await db.query(
            "INSERT INTO email (status, sender_email) VALUES ($1, $2) RETURNING id",
            [status, process.env.SENDER_EMAIL]
        );        

        console.log("Inserted email table");
    } catch (error) {
        console.error("Error inserting into the email table:", error);
    }
};


async function insertEmailContentTable(emailID, subject, body, image_data)
{
    try {
        //Need to query ID
        const timestamp = new Date();
        console.log("Values before query:", emailID, subject, body, timestamp);

        await db.query(
            "INSERT INTO email_content (id, subject, body, sent_at, image_data)  VALUES ($1, $2, $3, $4, $5)",
            [emailID, subject, body, timestamp, image_data]
        )

        console.log("Inserted email_content table");
    } catch (error) {
        console.error("Error inserting into the email table:", error);
    }
};


async function getCurrentEmailId()
{
    const emailIdResult = await db.query(
        "SELECT id FROM email ORDER BY id DESC LIMIT 1"
    );
    const emailId = emailIdResult.rows[0].id;
    return emailId;
};


async function insertCustomerContact(name, recipientEmail)
{
    try {
        await db.query(
            "INSERT INTO customer_contact (name, email_address) VALUES ($1, $2)",
            [name, recipientEmail]
        );

        console.log("Inserted Customer Contact");

    } catch (err) {
        if (err.code === '23505') {
            console.log(`Email: ${recipientEmail} already exists`);
        } else {
            console.error("Error inserting into the database:", err);
        }   
    }
}


async function insertRecordTable(recipientEmail, emailId)
{
    try {
        const customerIdResult = await db.query(
            "SELECT id FROM customer_contact WHERE LOWER(email_address) = LOWER($1)",
            [recipientEmail]
        )
        const customerId = customerIdResult.rows[0].id;

        // Insert into the history table
        await db.query(
            "INSERT INTO record (email_id, customer_id) VALUES ($1, $2)",
            [emailId, customerId]
        );

        console.log("Inserted record table");
    } catch (err) {
        console.error(`Customer with email ${recipientEmail} not found.`);
    }
};
