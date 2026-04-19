import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SchemaUser } from "@shared/schema";
import connectPg from "connect-pg-simple";

declare global {
  namespace Express {
    interface User extends SchemaUser {}
  }
}

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || 'brikvest_secret_key_2024',
    resave: false,
    saveUninitialized: false,
    store: new (connectPg(session))({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: false,
      tableName: "sessions",
    }),
    cookie: {
      secure: false, // Set to true in production with HTTPS
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      { usernameField: 'email' },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user || !user.isActive) {
            return done(null, false, { message: 'Invalid email or password' });
          }
          
          const isValid = await comparePasswords(password, user.password);
          if (!isValid) {
            return done(null, false, { message: 'Invalid email or password' });
          }
          
          // Auto-approve any legacy pending accounts on login
          if (user.accountStatus === 'pending') {
            await storage.updateUserStatus(user.id, 'approved');
            user.accountStatus = 'approved';
          }
          if (user.accountStatus === 'rejected') {
            return done(null, false, { message: 'Your membership application was not approved. Please contact support for more information.' });
          }
          
          // Update last login
          await storage.updateUserLastLogin(user.id);
          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });
}

