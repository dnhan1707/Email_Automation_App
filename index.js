import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import multer from "multer"; // Import multer
import xlsx from "xlsx";


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

//Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));


//Endpoints
app.get("/", (req, res) => {
    res.render("main.ejs");
});

app.post("/upload", upload.single("excelFile"), async (req, res) => {
    const uploadedFile = req.file.buffer;

    try {
        const workbook = xlsx.read(uploadedFile);
        const workbook_sheet = workbook.SheetNames;
        const workbook_response = xlsx.utils.sheet_to_json(
            workbook.Sheets[workbook_sheet[0]]
        );

        for (const row of workbook_response) {
            const name = row['Full Name'];
            const recipientEmail = row['Email'];

            // Insert customers' contacts
            try {
                await db.query(
                    "INSERT INTO customer_contacts (name, email) VALUES ($1, $2)",
                    [name, recipientEmail]
                );
            } catch (err) {
                if (err.code === '23505') {
                    console.log(`Email: ${recipientEmail} already exists`);
                } else {
                    console.error("Error inserting into the database:", err);
                }
            }
        }

        // If all inserts were successful, redirect
        res.redirect("/");

    } catch (err) {
        console.error("Error processing the uploaded file:", err);
        res.render("main.ejs", { error: "Error processing the file" });
    }
});




app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
  
