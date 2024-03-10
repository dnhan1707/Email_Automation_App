import express from "express";
import bodyParser from "body-parser";
import Mailjet from 'node-mailjet';
import pg from "pg";
import multer from "multer"; // Import multer
import xlsx from "xlsx";
import dotenv from 'dotenv';
import bcrypt, { hash } from 'bcrypt'
import session from "express-session"
import passport from "passport"
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2"
import { v4 as uuidv4 } from 'uuid';
import {
    DynamoDBClient,
  } from "@aws-sdk/client-dynamodb";

import { PutCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

//Basic connect with AWS DynamoDB
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

//Config the .env
dotenv.config();

//Saltround for Password Security
const saltround = 10;


//Connect with Mailjet
const mailjet = Mailjet.apiConnect( 
    process.env.MJ_APIKEY_PUBLIC,
    process.env.MJ_APIKEY_PRIVATE,
);



// Multer setup for local memory
const storage = multer.memoryStorage(); // Store the file in memory
const upload = multer({ storage: storage });
multer({
    limits: { fieldSize: 1000 * 1024 * 1024 }  //1GB
  })


//Connect to Postgresql
const db = new pg.Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});

db.connect();


//Web app set up
const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true })); // for handling form data
app.use(bodyParser.json()); // for handling JSON data
app.use(express.static("public"));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,    //1 day length cookie
    }
}))
app.use(passport.initialize());
app.use(passport.session());


//Create an Org for AWS DynamoDB
// await createAnOrg()

//--------------------------------------------------GET ROUTES-----------------------------------------------------------------------------------

//Endpoints for the path
app.get("/", async (req, res) => {
    res.render("homepage.ejs"); 
});


app.get("/main_page", async (req, res) => {
    if(req.isAuthenticated()){
        res.render("main.ejs");
    } else {
        res.redirect("/");
    }

});

app.get("/history", async (req, res) => {
    if(req.isAuthenticated()) {
        const emails = await queryAllEmail();
        res.render("history.ejs", {
            emails: emails
        });
    } else {
        res.redirect("/");
    }

});


app.get("/delete/:id", async(req, res) => {
    if(req.isAuthenticated()){
        await deleteEmailFromDatabase(req.params.id);
        res.redirect("/history");
    } else {
        res.redirect("/")
    }
})


app.get("/view/:id", async(req, res) => {
    if(req.isAuthenticated()) {
        const reqID = req.params.id;
        const contacts = await queryAllCustomerContacts();
        const emails_content = await queryEmailContentWithId(reqID);
        const chosenId = await queryCustomerIdByEmailIdFromRecord(reqID);
        const chosenIdJSON = JSON.stringify(chosenId);
        const emails = await queryEmailWithId(reqID);
        console.log(emails_content.body);

        res.render("modify.ejs", {
            emails_content: emails_content,
            chosenId: chosenIdJSON, // Pass the JSON string to the template
            contacts: contacts,
            emails: emails,
        });
    } else {
        res.redirect("/");
    }
})


//Endpoints for AUTHENTICATION
app.get("/register", async(req, res) => {
    res.render("register.ejs");
})



app.get("/login", async(req, res) => {
    res.render("login.ejs");
})


app.get("/logout", (req, res) => {
    req.logout((err) => {
        if(err){
            console.log(err);
        } else {
            res.redirect("/");
        }
    })
})

app.get(
    "/auth/google/secrets", 
    passport.authenticate("google", {
    successRedirect: "/main_page",
    failureRedirect: "/"
}))


app.get(
    "/auth/google", 
    passport.authenticate("google", {
    scope: ["profile", "email"],
}))

//Endpoints for funtionality of the app
app.get("/compose_email", async (req, res) => {

    if(req.isAuthenticated()){
        const contacts = await queryAllCustomerContacts();

        res.render("compose.ejs",{
            contacts: contacts
        });
    } else {
        res.redirect("/")
    }

});


app.get("/upload_contact", async (req, res) => {
    if(req.isAuthenticated()){
        res.render("upload_contact.ejs")
    } else {
        res.redirect("/")
    }
})


app.get("/send_email_with_mailjet_template", async (req, res) => {
    if(req.isAuthenticated()){
        const contacts = await queryAllCustomerContacts();

        res.render("send_with_mailjet_template.ejs",{
            contacts: contacts
        });    
    } else {
        res.redirect("/")
    }
})


//--------------------------------------------------POST ROUTES-----------------------------------------------------------------------------------


//Endpoints for funtionality of the app
app.post("/upload_contact", upload.single("excelFile"), async (req, res) => {
    if(req.isAuthenticated()){
        const uploadedFile = req.file.buffer;
        await upload_contact(uploadedFile);
        res.redirect("/main_page");
    } else {
        res.redirect("/")
    }
})


app.post("/send_email", async (req, res) => {
    try {
        const contacts = await queryAllCustomerContacts();
        if(contacts.length > 0){
            const selected_contacts = JSON.parse(req.body.selectedContacts) 
            console.log(selected_contacts);
            const email_id = req.body.email_id //From modify.ejs
            const isNewEmail = req.body.isNewEmail === "true"; // Convert string to boolean
            const pureHtml = req.body.pureHtml;
            console.log(pureHtml);
            // const uploadedFile = req.file.buffer;
            const subject = req.body.subject;
            const htmlPart = req.body.pureHtml;
            // const imageDataArray = JSON.parse(req.body.imageDataArray);
            const status = req.body.status;
            const sender = req.body.sender;
            const templateId = req.body.template_id;
            
            const selectedTime = req.body.selectedTime;
            console.log("Time: ", selectedTime);

            if(isNewEmail){
                await insertEmailTable(sender);
            }
            //Insert email

            await process_email_content(subject, pureHtml, htmlPart, status, isNewEmail, email_id, selected_contacts, templateId, selectedTime);

            res.redirect("/main_page");
        } else {
            res.status(500).send('There is no customers data');
        }



    } catch (err) {
        console.error("Error in /send_email endpoint:", err);
        res.status(500).send('An error occurred while sending the email');
    }
});


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
                    const result = await db.query(
                        "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
                        [loginEmail, hash]
                    );

                    const user = result.rows[0];
                    req.login(user, (err) => {
                        console.log(err);
                        res.redirect("/main_page");
                    });
                }
            })
        }
    }catch(err){
        console.log(err);
    }
})


app.post("/login", 
    passport.authenticate("local", {
    successRedirect: "/main_page",
    failureRedirect: "/login"
}))

//--------------------------------------------------SET UP FOR AUTHENTICATION-----------------------------------------------------------------------------------



passport.use(
    "local",
    new Strategy(async function verify(username, password, cb){
    try {
        const result = await db.query(
            "SELECT * FROM users WHERE email = $1", [username]
        )
        
        if(result.rows.length > 0)
        {
            const user = result.rows[0];
            const storedPassword = user.password;

            //Verify password
            bcrypt.compare(password, storedPassword, (err, result) => {
                if(err){
                    return cb(err);
                } else {
                    if(result){
                        return cb(null, user);
                        // res.render("main.ejs");
                    } else {
                        return cb(null, false);
                    }
                }
            });
        } else {
            return cb("User not found")
        }
    } catch (err) {
        return cb(err);
    }
}))


passport.use(
    "google", 
    new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "http://localhost:3000/auth/google/secrets",
        userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
        }, async(accessToken, refreshToken, profile, cb) => {
            try{
                const result = await db.query(
                    "SELECT * FROM users WHERE email = $1", [profile.email]
                )

                if(result.rows.length === 0){
                    const newUser = await db.query(
                        "INSERT INTO users (email, password) VALUES ($1, $2)", [
                            profile.email,
                            "google"
                        ]
                    );
                    return cb(null, newUser.rows[0]);
                }else{
                    //Already exist
                    return cb(null, result.rows[0])
                }
            }catch{
                return cb(err);
            }
        })
)

passport.serializeUser((user, cb) => {
    cb(null, user);
})


passport.deserializeUser((user, cb) => {
    cb(null, user);
})


app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});


//--------------------------------------------------FLOW OF THE PROGRAM-----------------------------------------------------------------------------------

/**
 * Upload Customer Contacts From Excel File
 * @param {*} uploadedFile 
 */
async function upload_contact(uploadedFile){
    try{
        
        const workbook = xlsx.read(uploadedFile);
        const workbook_sheet = workbook.SheetNames;
        const workbook_response = xlsx.utils.sheet_to_json(
            workbook.Sheets[workbook_sheet[0]]
        );


        for (const row of workbook_response) {
            const name = row['Full Name'];
            const recipientEmail = row['Email'];

            //Insert customers' contacts
            await insertCustomerContact(name, recipientEmail);
        }
    } catch (err){
        console.log(err);
    }
}

/*
    Insert into email content table
 */
async function process_email_content(subject, pureHtml, htmlPart, status, isNewEmail, modify_email, selected_contacts_id, template_id, selectedTime)
{
    try {

        //Get current email id
        const emailID = await getCurrentEmailId();

        if(isNewEmail){
            //Insert email_content
            await insertEmailContentTable(emailID, status, subject, pureHtml, template_id, selectedTime);
        } else {
            await updateEmailContentTable(modify_email, status, subject, pureHtml, template_id, selectedTime);
        }

        await process_email_record_and_send_email(emailID, subject, htmlPart, status, isNewEmail, modify_email, selected_contacts_id, template_id);


    } catch (err) {
        console.error("Error processing the uploaded file:", err);
    }
}


/*
    Insert or Update record table, Send or Save email base on Status
*/
async function process_email_record_and_send_email(emailID, subject, htmlPart, status, isNewEmail, modify_email, selected_contacts_id, template_id){
    try {
        var newIds = [];
        const existingCustomerIDsResult = await db.query(
            "SELECT customer_id FROM record WHERE email_id = $1",
            [modify_email]
        );
        const existingCustomerIDs = existingCustomerIDsResult.rows.map(row => row.customer_id);

        const contacts = await queryAllCustomerContactsById(selected_contacts_id);
        for (const contact of contacts){
            const customer_name = contact.name;
            const customer_email = contact.email_address;

            if(status === 'sent')
            {
                //Insert record table
                await insertRecordTable(customer_email, emailID);
                await send_email(customer_name, customer_email, subject, htmlPart, template_id);
            }
            else
            {
                if(isNewEmail)
                {
                    await insertRecordTable(customer_email, emailID);
                }
                else{
                    const newId = await updateRecordTable(customer_email, modify_email);
                    newIds.push(newId);
                }

            }
        };
        
        if (status != "sent")
        {
            console.log("newIds: ", newIds);
            // Determine IDs to delete from record table
            const idsToDelete = existingCustomerIDs.filter(id => !newIds.includes(id));
            console.log("idsToDelete: ", idsToDelete);

            // Delete records from record table
            if (idsToDelete.length > 0) {
                for (const idToDelete of idsToDelete) {
                    await deleteFromRecordTableByEmailIdAndCustomerId(modify_email, idToDelete);
                }
            }
        }



    } catch (error) {
        console.log("Error in process_email_record_and_send_email function ", error)
    }

}


/*
    Send email
*/
async function send_email(recipientName, recipientEmail, subject, html_part, template_id) {
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
        if(template_id.length > 0){
            message["TemplateID"] = parseInt(template_id);
            message["TemplateLanguage"] = true;
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
        
        // //Insert record table
        // await insertRecordTable(recipientEmail, emailID);

    } catch (err) {
        console.error("Error in send_email function:", err);
        throw err;
    }
}



//--------------------------------------------------DATA MANGING-----------------------------------------------------------------------------------
//Insert Methods

async function insertEmailTable(sender_email)
{
    try {
        await db.query(
            "INSERT INTO email (sender_email) VALUES ($1)",
            [sender_email]
        );        

        console.log("Inserted email table");
    } catch (error) {
        console.error("Error inserting into the email table:", error);
    }
}


async function insertEmailContentTable(emailID, status, subject, body, template_id, selectedTime)
{
    try {
        //Need to query ID
        const timestamp = new Date();

        if(selectedTime.length == 0){
            selectedTime = null;
        }

        if(body === ""){
            body = null;
        }

        await db.query(
            "INSERT INTO email_content (id, status, subject, template_id, body, created_at, sent_at)  VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [emailID, status, subject, template_id, body, timestamp, selectedTime]
        )

        console.log("Inserted email_content table");
    } catch (error) {
        console.error("Error inserting into the email table:", error);
    }
}

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
}


//-----------------------------------------------------------------------------------------------------------------------------------------
//Query Methods

async function queryAllCustomerContacts(){
    try{
        const result = await db.query(
            "SELECT * FROM customer_contact"
        )

        return result.rows;
    } catch (err) {
        console.log("Error while query customer contacts");
    }
}


async function queryAllCustomerContactsById(selected_contacts_id){
    try{
        
        const formatted_contacts_id = selected_contacts_id.map(id => parseInt(id)).join(","); // Format array without extra quotes
        const result = await db.query(
            "SELECT * FROM customer_contact WHERE id IN (" + formatted_contacts_id + ")"
        );
        return result.rows;
    } catch (err) {
        console.log("Error while query customer contacts by Id");
        console.log(err);
    }
}

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


async function queryEmailContentWithId(id){
    try{
        const result = await db.query(
            "SELECT * FROM email_content WHERE id = ($1)", [id]
        )
        console.log("Queried email_content id: ", id)
        return result.rows[0];
    }catch (err) {
        console.log("Error in queryEmailContentWithId method");
    }
}


async function queryEmailWithId(id){
    try{
        const result = await db.query(
            "SELECT * FROM email WHERE id = ($1)", [id]
        )
        console.log("Queried email id: ", id)
        return result.rows[0];
    }catch (err) {
        console.log("Error in queryEmailWithId method");
    }
}

async function queryCustomerIdByEmailIdFromRecord(reqID){
    try {
        const result = await db.query(
            "SELECT customer_id FROM record WHERE email_id = $1", [reqID]
        )
        return result.rows;
    } catch (error) {
        console.log("Error in queryCustomerIdByEmailIdFromRecord");
        console.log(error);
    }
}

//-----------------------------------------------------------------------------------------------------------------------------------------
//Delete Methods

async function deleteEmailFromDatabase(id){
    await deleteFromRecordTable(id);
    await deleteFromEmailContentTable(id);
    await deleteFromEmailTable(id);
}


async function deleteFromEmailTable(id){
    try {
        await db.query(
            "DELETE FROM email WHERE id = $1", [id]
        )

        console.log("Deleted: " + id + " From email table");
    } catch (err) {
        console.log("Error in deleting from Email table");
    }
}


async function deleteFromRecordTable(id){
    try {
        await db.query(
            "DELETE FROM record WHERE email_id = $1", [id]
        )

        console.log("Deleted: " + id + " From record table");
    } catch (err) {
        console.log("Error in deleting from Record table");
    }
}

async function deleteFromEmailContentTable(id){
    try {
        await db.query(
            "DELETE FROM email_content WHERE id = $1", [id]
        )

        console.log("Deleted: " + id + " From email content table");

    } catch (err) {
        console.log("Error in deleting from Email_Content table");
    }
}

async function deleteFromRecordTableByEmailIdAndCustomerId(modify_email, idToDelete)
{
    try {
        await db.query(
            "DELETE FROM record WHERE email_id = $1 AND customer_id = $2", [modify_email, idToDelete]
        )

        console.log("Deleted email " + modify_email + " With customer: " + idToDelete + " From record table");
    } catch (err) {
        console.log("Error in deleting from Record table ", err);
    }
}


//-----------------------------------------------------------------------------------------------------------------------------------------
//Update Methods
async function updateEmailContentTable(emailID, status, subject, pureHtml, template_id, selectedTime){
    try {
        if(selectedTime.length == 0){
            selectedTime = null;
        }
        if(pureHtml === "")
        {
            await db.query(
                "UPDATE email_content SET status = ($1), subject = ($2), template_id = ($3), body = ($4), sent_at = ($5) WHERE id = ($6)", [status, subject, template_id, null, selectedTime, emailID]
            )
        } else {
            await db.query(
                "UPDATE email_content SET status = ($1), subject = ($2), template_id = ($3), body = ($4), sent_at = ($5) WHERE id = ($6)", [status, subject, template_id, pureHtml, selectedTime, emailID]
            )
        }


        console.log("Updated: " + emailID + " in email content table");

    } catch (err){
        console.log(err);
    }
}


async function updateRecordTable(recipientEmail, emailID) {
    try {
        const newIds = []
        
        const customerIdResult = await db.query(
            "SELECT id FROM customer_contact WHERE LOWER(email_address) = LOWER($1)",
            [recipientEmail]
        );
        const customerId = customerIdResult.rows[0].id;
        

        // Check if record already exists for this emailID and customerId
        const existingRecord = await db.query(
            "SELECT * FROM record WHERE email_id = $1 AND customer_id = $2",
            [emailID, customerId]
        );

        if (existingRecord.rows.length === 0) {
            // Insert new record since it doesn't exist
            await db.query(
                "INSERT INTO record (email_id, customer_id) VALUES ($1, $2)",
                [emailID, customerId]
            );
            newIds.push(customerId);
            console.log("added: "+customerId+" to newIds");

        } else {
            newIds.push(customerId);
            console.log("added: "+customerId+" to newIds");

            // Record already exists, no need to do anything
        }
        console.log("Updated: " + emailID + " in record table");

        return newIds[0];

    } catch (err) {
        console.log(err);
    }
}

async function getCurrentEmailId()
{
    const emailIdResult = await db.query(
        "SELECT id FROM email ORDER BY id DESC LIMIT 1"
    );
    const emailId = emailIdResult.rows[0].id;
    return emailId;
}


//--------------------------------------------------AWS DYNAMODB (STILL IN PROGRESS)-----------------------------------------------------------------------------------


async function createAnOrg(){
    const orgID = uuidv4();
    const params = new PutCommand({
        TableName : 'email_automation_project',
        Item: {
            PK: `ORG#${orgID}`,
            SK: `#METADATA#${orgID}`,
            name: "My Organization",
            tier: "Free tier"
        }
      });
      
      await docClient.send(params);
    //   dynamodb.put(params, function(err, data) {
    //     if (err) console.log(err);
    //     else console.log(data);
    //   });
}
