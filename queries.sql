DROP TABLE record;
DROP TABLE email_content;
DROP TABLE email;
DROP TABLE customer_contact;


CREATE TABLE customer_contact(
    id serial PRIMARY KEY,
    name VARCHAR(25),
    email_address TEXT UNIQUE
);


CREATE TABLE email(
    id serial PRIMARY KEY,
    status VARCHAR(10),
    sender_email TEXT
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
