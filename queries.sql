CREATE TABLE customer_contact(
    id PRIMARY KEY,
    name VARCHAR(25),
    email_address TEXT UNIQUE
);


CREATE TABLE email(
    id PRIMARY KEY,
    status VARCHAR(10),
    sender_email TEXT,
);


CREATE TABLE email_content(
    id int REFERENCES email(id),
    subject text,
    body text,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    image_data TEXT
);


CREATE TABLE record(
    email_id INT REFERENCES email(id),
    customer_id INT REFERENCES customer_contact(id),
    PRIMARY KEY (email_id, customer_id)
);

