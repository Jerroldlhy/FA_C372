-- Schema aligned to app.js (tables + view)
CREATE DATABASE IF NOT EXISTS fa_c372;
USE fa_c372;

SET FOREIGN_KEY_CHECKS = 0;
DROP VIEW IF EXISTS instructors;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS wallet;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student','lecturer','admin') DEFAULT 'student',
  email_verified TINYINT(1) DEFAULT 0,
  verification_token VARCHAR(128) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY email (email),
  KEY verification_token (verification_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE courses (
  id INT NOT NULL AUTO_INCREMENT,
  course_name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  category VARCHAR(100) DEFAULT NULL,
  instructor_id INT DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY instructor_id (instructor_id),
  CONSTRAINT courses_instructor_fk FOREIGN KEY (instructor_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE enrollments (
  id INT NOT NULL AUTO_INCREMENT,
  course_id INT NOT NULL,
  student_id INT NOT NULL,
  progress INT DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY course_id (course_id),
  KEY student_id (student_id),
  CONSTRAINT enrollments_course_fk FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT enrollments_student_fk FOREIGN KEY (student_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE wallet (
  user_id INT NOT NULL,
  balance DECIMAL(10,2) DEFAULT 0.00,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT wallet_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE transactions (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('pending','completed','failed') DEFAULT 'pending',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY user_id (user_id),
  CONSTRAINT transactions_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE course_reviews (
  id INT NOT NULL AUTO_INCREMENT,
  course_id INT NOT NULL,
  student_id INT NOT NULL,
  rating TINYINT NOT NULL,
  review TEXT,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY course_student_unique (course_id, student_id),
  CONSTRAINT course_reviews_course_fk FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT course_reviews_student_fk FOREIGN KEY (student_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE VIEW instructors AS
  SELECT id, name
  FROM users
  WHERE role = 'lecturer';

INSERT INTO users (name, email, password_hash, role, email_verified)
VALUES
  ('Mary Jane', 'maryjane@gmail.com', '$2b$10$OXvESkeAFk2vS3PPMPZquOrbFAD3O.TMa/PFGXaV9Ah.kh110k4uS', 'student', 1),
  ('Admin1', 'admin1@admin.com', '$2b$10$OXvESkeAFk2vS3PPMPZquOrbFAD3O.TMa/PFGXaV9Ah.kh110k4uS', 'admin', 1);
