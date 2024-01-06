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
    res.render("compose_email.ejs");
});

app.post("/send_email", upload.single("excelFile"), async (req, res) => {
    try {
        const uploadedFile = req.file.buffer;
        const subject = req.body.subject;
        const modifiedHtmlContent = req.body.modifiedHtmlContent;
        const imageDataArray = JSON.parse(req.body.imageDataArray);
        
        console.log("imageDataArray ", imageDataArray);


        await process_contact_file(uploadedFile, subject, modifiedHtmlContent, imageDataArray);
        res.redirect("/");
    } catch (err) {
        console.error("Error in /send_email endpoint:", err);
        res.status(500).send('An error occurred while sending the email');
    }
});

//Process Customer Contact File
async function process_contact_file(uploadedFile, subject, modifiedHtmlContent, imageDataArray)
{

    try {
        const base64content = imageDataArray[0].Base64Content;
        const workbook = xlsx.read(uploadedFile);
        const workbook_sheet = workbook.SheetNames;
        const workbook_response = xlsx.utils.sheet_to_json(
            workbook.Sheets[workbook_sheet[0]]
        );


        ///INSERT DATA INTO POSTGRESQL
        //Insert email
        const timestamp = new Date();

        try {
            await db.query(
                "INSERT INTO email (sender_email, subject, body, sent_at, image_data)  VALUES ($1, $2, $3, $4, $5)",
                [process.env.SENDER_EMAIL, subject, modifiedHtmlContent, timestamp, base64content]
            )
        } catch (error) {
            console.error("Error inserting into the email table:", error);
        }

        // Insert into the record table
        const emailIdResult = await db.query(
            "SELECT email_id FROM email ORDER BY email_id DESC LIMIT 1"
        );
        const emailId = emailIdResult.rows[0].email_id;

        for (const row of workbook_response) {
            const name = row['Full Name'];
            const recipientEmail = row['Email'];

            // Insert customers' contacts
            try {
                await db.query(
                    "INSERT INTO customer_contact (name, email_address) VALUES ($1, $2)",
                    [name, recipientEmail]
                );

            } catch (err) {
                if (err.code === '23505') {
                    console.log(`Email: ${recipientEmail} already exists`);
                } else {
                    console.error("Error inserting into the database:", err);
                }   
            }

            await process_email(emailId, name, recipientEmail, subject, modifiedHtmlContent, imageDataArray);
        }



    } catch (err) {
        console.error("Error processing the uploaded file:", err);
        res.render("main.ejs", { error: "Error processing the file" });
    }
}


async function process_email(emailId, recipientName, recipientEmail, subject, html_part, imageDataArray) {
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
        
        const customerIdResult = await db.query(
            "SELECT customer_id FROM customer_contact WHERE email_address = $1",
            [recipientEmail]
        )
        try {
            const customerId = customerIdResult.rows[0].customer_id;

            // Insert into the history table
            await db.query(
                "INSERT INTO record (email_id, customer_id) VALUES ($1, $2)",
                [emailId, customerId]
            );

            console.log(result.body);
        } catch (err) {
            console.error(`Customer with email ${recipientEmail} not found.`);
        }

    } catch (err) {
        console.error("Error in process_email function:", err);
        throw err;
    }
}

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
  
