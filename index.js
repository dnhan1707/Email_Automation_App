import express from "express";
import bodyParser from "body-parser";
import Mailjet from 'node-mailjet';
import pg from "pg";
import multer from "multer"; // Import multer
import xlsx from "xlsx";
import dotenv from 'dotenv';
import bcrypt, { hash } from 'bcrypt'


dotenv.config();

const saltround = 10;

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
    res.render("homepage.ejs");
});

    
app.get("/history", async (req, res) => {
    const emails = await queryAllEmail();
    res.render("history.ejs", {
        emails: emails
    });
});

app.post("/compose_email", async (req, res) => {
    res.render("compose.ejs");
});

app.post("/send_email", upload.single("excelFile"), async (req, res) => {
    try {
        const pureHtml = req.body.pureHtml;
        const uploadedFile = req.file.buffer;
        const subject = req.body.subject;
        const htmlPart = req.body.modifiedHtmlContent;
        const imageDataArray = JSON.parse(req.body.imageDataArray);
        const status = req.body.status;

        //Insert email
        await insertEmailTable();

        await process_contact_file(uploadedFile, subject, pureHtml, htmlPart, imageDataArray, status);

        res.redirect("/");

    } catch (err) {
        console.error("Error in /send_email endpoint:", err);
        res.status(500).send('An error occurred while sending the email');
    }
});


app.get("/view/:id", async(req, res) => {
    const reqID = req.params.id;
    const emails = await queryEmailWithId(reqID);
    console.log(emails);


    res.render("modify.ejs", {
        emails: emails
    })
})


app.get("/login", async(req, res) => {
    res.render("login.ejs");
})


app.post("/login", async(req, res) =>{
    const loginEmail = req.body.loginEmail;
    const loginPassword = req.body.loginPassword;

    try {
        const result = await db.query(
            "SELECT * FROM users WHERE email = $1", [loginEmail]
        )
        
        if(result.rows.length > 0)
        {
            const user = result.rows[0];
            const storedPassword = user.password;

            //Verify password
            bcrypt.compare(loginPassword, storedPassword, (err, result) => {
                if(err){
                    console.error("Error comparing passwords:", err);
                } else {
                    if(result){
                        res.render("main.ejs");
                    } else {
                        res.send("Incorrect Password");
                    }
                }
            })
        } else {
            res.send("User not found");
        }
    } catch (err) {
        console.log(err);
    }

})


app.get("/register", async(req, res) => {
    res.render("register.ejs");
})

app.post("/register", async(req, res) => {
    const loginEmail = req.body.loginEmail;
    const loginPassword = req.body.loginPassword;

    try {
        const result = await db.query(
            "SELECT * FROM users WHERE email = $1", [loginEmail]
        )

        if(result.rows.length > 0)
        {
            res.send("Email Already exist, try to login please");
        } else {
            bcrypt.hash(loginPassword, saltround, async (err, hash) => {
                if(err)
                {
                    console.error("Error in hashing password");
                }else{
                    await db.query(
                        "INSERT INTO users (email, password) VALUES ($1, $2)",
                        [loginEmail, hash]
                    );
                    res.redirect("/login");
                }
            })
        }
    }catch(err){
        console.log(err);
    }
})

//Process Customer Contact File
async function process_contact_file(uploadedFile, subject, pureHtml, htmlPart, imageDataArray, status)
{

    try {
        // let base64content = "";
        // if(imageDataArray.length > 0)
        // {
        //     base64content = imageDataArray[0].Base64Content;
        // }
        const workbook = xlsx.read(uploadedFile);
        const workbook_sheet = workbook.SheetNames;
        const workbook_response = xlsx.utils.sheet_to_json(
            workbook.Sheets[workbook_sheet[0]]
        );

        // //Insert email
        // await insertEmailTable(status);

        //Get current email id
        const emailID = await getCurrentEmailId();

        // //Insert email_content
        // await insertEmailContentTable(emailID, subject, htmlPart, base64content);


        //Insert email_content
        await insertEmailContentTable(emailID, status, subject, pureHtml);

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
  


async function insertEmailTable()
{
    try {
        await db.query(
            "INSERT INTO email (sender_email) VALUES ($1)",
            [process.env.SENDER_EMAIL]
        );        

        console.log("Inserted email table");
    } catch (error) {
        console.error("Error inserting into the email table:", error);
    }
};


async function insertEmailContentTable(emailID, status, subject, body)
{
    try {
        //Need to query ID
        const timestamp = new Date();
        console.log("Values before query:", emailID, status, subject, body, timestamp);

        await db.query(
            "INSERT INTO email_content (id, status, subject, body, sent_at)  VALUES ($1, $2, $3, $4, $5)",
            [emailID, status, subject, body, timestamp]
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


async function queryAllEmail()
{
    try{
        const result = await db.query(
            "SELECT * FROM email_content"
        )
        
        return result.rows;
    }catch (err) {
        console.log("Error in queryAllEmail method");
    }
}


async function queryEmailWithId(id){
    try{
        const result = await db.query(
            "SELECT * FROM email_content WHERE id = ($1)", [id]
        )

        return result.rows[0];
    }catch (err) {
        console.log("Error in queryEmailWithId method");
    }
}
