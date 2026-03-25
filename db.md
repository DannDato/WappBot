
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

CREATE TABLE owner_instructions (
	id INT(11) NOT NULL AUTO_INCREMENT,
	user_id VARCHAR(50) NOT NULL COLLATE 'utf8mb4_uca1400_ai_ci',
	contact_label VARCHAR(120) NULL DEFAULT NULL COLLATE 'utf8mb4_uca1400_ai_ci',
	topic VARCHAR(255) NOT NULL COLLATE 'utf8mb4_uca1400_ai_ci',
	response TEXT NOT NULL COLLATE 'utf8mb4_uca1400_ai_ci',
	expires_at DATETIME NOT NULL,
	created_at TIMESTAMP NULL DEFAULT current_timestamp(),
	PRIMARY KEY (id) USING BTREE,
	INDEX idx_owner_user_topic (user_id, topic) USING BTREE,
	INDEX idx_owner_expires (expires_at) USING BTREE
)
COLLATE='utf8mb4_uca1400_ai_ci'
ENGINE=InnoDB
;
