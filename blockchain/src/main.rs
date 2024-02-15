use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use hex;

// 블록 구조체 정의
struct Block {
    index: u32,
    timestamp: u64,
    data: String,
    previous_hash: String,
    hash: String,
}

// 블록체인 구조체 정의
struct Blockchain {
    chain: Vec<Block>,
}

impl Blockchain {
    // 블록 생성
    fn create_block(&mut self, data: String) {
        let previous_block = self.chain.last().unwrap();
        let previous_hash = &previous_block.hash;
        let index = previous_block.index + 1;
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        let hash = Self::calculate_hash(index, timestamp, data.clone(), previous_hash.clone());

        let new_block = Block {
            index,
            timestamp,
            data,
            previous_hash: previous_hash.clone(),
            hash,
        };

        self.chain.push(new_block);
    }

    // 해시 값 계산
    fn calculate_hash(index: u32, timestamp: u64, data: String, previous_hash: String) -> String {
        let input = format!("{}{}{}{}", index, timestamp, data, previous_hash);
        let mut hasher = Sha256::new();
        hasher.update(input.as_bytes());
        let result = hasher.finalize();
        hex::encode(result)
    }
}

fn main() {
    // 블록체인 인스턴스 생성
    let mut blockchain = Blockchain {
        chain: vec![Block {
            index: 0,
            timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
            data: String::from("Genesis Block"),
            previous_hash: String::from("0"),
            hash: String::from("genesis_hash"),
        }],
    };

    // 블록 생성 및 체인에 추가
    blockchain.create_block(String::from("Block 1"));
    blockchain.create_block(String::from("Block 2"));

    // 블록체인 출력
    for block in blockchain.chain {
        println!("Index: {}", block.index);
        println!("Timestamp: {}", block.timestamp);
        println!("Data: {}", block.data);
        println!("Previous Hash: {}", block.previous_hash);
        println!("Hash: {}", block.hash);
        println!("------------------------");
    }
}
