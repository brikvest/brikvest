import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import { db } from "../server/db";
import { adminUsers } from "../shared/schema";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function createAdminUsers() {
  try {
    console.log("Creating admin users...");
    
    // Clear existing admin users
    await db.delete(adminUsers);
    
    const charlesPassword = await hashPassword("charles123");
    const dejPassword = await hashPassword("dej123");
    const samPassword = await hashPassword("sam123");
    
    const newAdmins = await db.insert(adminUsers).values([
      {
        username: "charles",
        password: charlesPassword,
        role: "admin"
      },
      {
        username: "dej", 
        password: dejPassword,
        role: "admin"
      },
      {
        username: "sam",
        password: samPassword,
        role: "admin"
      }
    ]).returning();
    
    console.log("Admin users created successfully:");
    console.log("- Username: charles, Password: charles123");
    console.log("- Username: dej, Password: dej123");
    console.log("- Username: sam, Password: sam123");
    
    process.exit(0);
  } catch (error) {
    console.error("Error creating admin users:", error);
    process.exit(1);
  }
}

createAdminUsers();