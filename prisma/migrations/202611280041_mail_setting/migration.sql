CREATE TABLE "MailSetting" (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sender TEXT NOT NULL,
  "encryptedKey" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
