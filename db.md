
CREATE TABLE messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE conversations (
  user_id VARCHAR(50) PRIMARY KEY,
  human_active BOOLEAN DEFAULT FALSE,
  last_human_message TIMESTAMP NULL
);

CREATE TABLE learned_responses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_input TEXT NOT NULL,
  bot_response TEXT NOT NULL,
  embedding JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE learned_responses MODIFY embedding JSON;