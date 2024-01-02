import express from "express";
import bodyParser from "body-parser";
import Mailjet from 'node-mailjet';
import pg from "pg";
import multer from "multer"; // Import multer
import xlsx from "xlsx";

const mailjet = Mailjet.apiConnect( 
    process.env.MJ_APIKEY_PUBLIC,
    process.env.MJ_APIKEY_PRIVATE,
);

// Multer setup
const storage = multer.memoryStorage(); // Store the file in memory
const upload = multer({ storage: storage });

//Postgresql
const db = new pg.Client({
    user: "postgres",
    host: "localhost",
    database: "customer",
    password: "nhancho1707",
    port: 5432
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
    const uploadedFile = req.file.buffer;
    const subject = req.body.subject;
    const modifiedHtmlContent = req.body.modifiedHtmlContent;
    const imageDataArray = req.body.imageDataArray; // Parse JSON data

    console.log("modifiedHtmlContent ", modifiedHtmlContent);
    await process_contact_file(uploadedFile, subject, modifiedHtmlContent, imageDataArray);
    res.status(200).send("Excel file successfully uploaded.");
});


//Process Customer Contact File
async function process_contact_file(uploadedFile, subject, modifiedHtmlContent, imageDataArray)
{

    try {
        const workbook = xlsx.read(uploadedFile);
        const workbook_sheet = workbook.SheetNames;
        const workbook_response = xlsx.utils.sheet_to_json(
            workbook.Sheets[workbook_sheet[0]]
        );

        for (const row of workbook_response) {
            const name = row['Full Name'];
            const recipientEmail = row['Email'];

            await process_email(name, recipientEmail, subject, modifiedHtmlContent, imageDataArray);

            // Insert customers' contacts
            // try {
            //     await db.query(
            //         "INSERT INTO customer_contact (name, email) VALUES ($1, $2)",
            //         [name, recipientEmail]
            //     );
            // } catch (err) {
            //     if (err.code === '23505') {
            //         console.log(`Email: ${recipientEmail} already exists`);
            //     } else {
            //         console.error("Error inserting into the database:", err);
            //     }   
            // }
        }

        // If all inserts were successful, redirect

    } catch (err) {
        console.error("Error processing the uploaded file:", err);
        res.render("main.ejs", { error: "Error processing the file" });
    }
}


async function process_email(recipientName, recipientEmail, subject, html_part, imageDataArray)
{
    if (imageDataArray.length > 0) {

        console.log(imageDataArray);

        // const request = mailjet
        // .post("send", { version: "v3.1" })
        // .request({
        //     Messages: [
        //         {
        //             From: {
        //                 Email: "dnhan1707@gmail.com",
        //                 Name: "BET Club",
        //             },
        //             To: [
        //                 {   
        //                     Email: recipientEmail,
        //                 },
        //             ],
        //             "Subject": subject,
        //             "HTMLPart": `<h3> Dear ${recipientName},</h3> </br> <p>hi</p><img src=\"cid:id1\">`,
        //             "InlinedAttachments": [
        //                 {
        //                     ContentType: "image/png",
        //                     Filename: "icons8-smile-30.png",
        //                     ContentID: "id1",
        //                     Base64Content: "iVBORw0KGgoAAAANSUhEUgAAAB4AAAAeCAYAAAA7MK6iAAAACXBIWXMAAAsTAAALEwEAmpwYAAABtElEQVR4nO2WS04CQRCGv7hVdi5UMEYlwl0U1z6iewQXRo4g7t2J8QAGxYUKnoArYEg8hIobhAmmk5+kM7GH5qFxwZd0MpmpR1dNV1XDlH/IMpAHnoEX4FPLPNeAHJCYpMM4UAI6QG/ACoAysDKu023gQ0bbwA2wA6SAWS3zvKtvbckancyoTo8VQU9RrHrorAF3VvTm1wwdaQB0gZMRNn0q3WCYyONWekdxajs3Nt6BRR+Fayu941KRrZJPyXR1SHz+6SDWZaujTDrJa4fmhE6KsmweRQnVJGTKY1Lsy+ZTlFBTQhuh9+fqUsUIXZdMSjZNh3PSP82x0PuW1RhcuGRiHrpOx0UZPovQdcl4OW46Uj0Oadls/MvDlfvFcspGCSVU7G01/DAP+h0HwILWIfDqiCjp20AMV9qhmTJhHiNmcfUH+Xt9u8SDJet0m0ZvM6MI69YNpK4MmG82Bdl4U2a8yFhjMezch4I1FjeHVc5bF4GKGv4gklZ6Ax3WkdjSPO1ffcwJ3VNtzmmlVTK3wJeV3qEjDTMPXHhe9jqavV6D35e4arGqLtTSaqiUsj4lM4W/5htQBKXMvXFg5AAAAABJRU5ErkJggg=="
        //                 }
        //             ]
        //         },
        //     ],
        // });
        // request
        //     .then((result) => {
        //         console.log(result.body);
        //     })
        //     .catch((err) => {
        //         console.log("Could not send email picture");
        //     });
    }
    else
    {
        const request = mailjet
        .post("send", { version: "v3.1" })
        .request({
            Messages: [
                {
                    From: {
                        Email: "dnhan1707@gmail.com",
                        Name: "BET Club",
                    },
                    To: [
                        {
                            Email: recipientEmail,
                        },
                    ],
                    "Subject": subject,
                    "HTMLPart": `<h3> Dear ${recipientName},</h3> </br> ${html_part}`,
                },
            ],
        });
        request
            .then((result) => {
                console.log(result.body);
            })
            .catch((err) => {
                console.log("Could not send email");
            });
    }
}

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
  



//export MJ_APIKEY_PUBLIC='bd8c6c5ade4bb14477ab8bfbe4f5d850'
//export MJ_APIKEY_PRIVATE='a845c0074daacba1822d47151520fb69'
//FEUMD3NDEFHJSHPJ2SQ7YNQ6
