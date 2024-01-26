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

//Endpoints
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
        const emails = await queryEmailWithId(reqID);


        res.render("modify.ejs", {
            emails: emails
        })
    } else {
        res.redirect("/");
    }
})

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




app.post("/compose_email", async (req, res) => {
    if(req.isAuthenticated())
    {
        const contacts = await queryAllCustomerContacts();

        res.render("compose.ejs",{
            contacts: contacts
        });
    } else {
        res.redirect("/");
    }

});

app.post("/send_email", upload.single("excelFile"), async (req, res) => {
    try {
        const email_id = req.body.email_id //From modify.ejs
        const isNewEmail = req.body.isNewEmail === "true"; // Convert string to boolean
        const pureHtml = req.body.pureHtml;
        const uploadedFile = req.file.buffer;
        const subject = req.body.subject;
        const htmlPart = req.body.modifiedHtmlContent;
        const imageDataArray = JSON.parse(req.body.imageDataArray);
        const status = req.body.status;

        
        if(isNewEmail){
            await insertEmailTable();
        }
        //Insert email

        await process_contact_file(uploadedFile, subject, pureHtml, htmlPart, imageDataArray, status, isNewEmail, email_id);

        res.redirect("/main_page");

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


//-----------------------------------------------------------------------------------------------------------------------------------------
//Process Customer Contact File
async function process_contact_file(uploadedFile, subject, pureHtml, htmlPart, imageDataArray, status, isNewEmail, modify_email)
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

        if(isNewEmail){
            //Insert email_content
            await insertEmailContentTable(emailID, status, subject, pureHtml);
        } else {
            await updateEmailContentTable(modify_email, status, subject, pureHtml);
        }


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
                if(isNewEmail)
                {
                    await insertRecordTable(recipientEmail, emailID);
                }
                else{
                    await updateRecordTable(recipientEmail, modify_email);
                }

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
        console.log("Queried email id: ", id)
        return result.rows[0];
    }catch (err) {
        console.log("Error in queryEmailWithId method");
    }
}


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


async function updateEmailContentTable(emailID, status, subject, pureHtml){
    try {
        await db.query(
            "UPDATE email_content SET status = ($1), subject = ($2), body = ($3) WHERE id = ($4)", [status, subject, pureHtml, emailID]
        )

        console.log("Updated: " + emailID + " in email content table");

    } catch (err){
        console.log(err);
    }
}


async function updateRecordTable(recipientEmail, emailID){
    try {
        const customerIdResult = await db.query(
            "SELECT id FROM customer_contact WHERE LOWER(email_address) = LOWER($1)",
            [recipientEmail]
        )
        const customerId = customerIdResult.rows[0].id;

        await db.query(
            "UPDATE record SET email_id = $1 WHERE customer_id = $2", 
            [emailID, customerId]
        );

        console.log("Updated: " + emailID + " in record table");

    } catch (err) {
        console.log(err);
    }
}

