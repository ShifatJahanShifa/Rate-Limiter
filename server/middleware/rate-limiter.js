const { response } = require('express');
const Redis = require('ioredis')
const moment = require('moment')
const redis = require("redis")

const redisClient = new Redis({
  url: "redis://localhost:6379"
});


redisClient.on("error", (err) => {
  console.error("Redis error:", err);
});

module.exports = {
  // with race condition
  tokenBucket: async (req, res, next) => {
    try {
      const key = `global_token_bucket`;
      const capacity = 20;
      const refillRate = 20;
      const refillInterval = 60000;
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const seconds = now.getSeconds().toString().padStart(2, '0');
      const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
      const calc=`${hours}:${minutes}:${seconds}:${milliseconds}`
      // await redisClient.del(key);

      let [tokens, lastRefillTime] = await redisClient.hmget(key, 'tokens', 'lastRefillTime');
      tokens = tokens ? parseInt(tokens) : capacity;
      lastRefillTime = lastRefillTime ? parseInt(lastRefillTime) : Date.now();


      const timeElapsed = Math.max(0, Date.now() - lastRefillTime);
      if (timeElapsed >= refillInterval) {
        const tokensToAdd = Math.floor(((timeElapsed) / refillInterval) * refillRate);
        // console.log("tokentoadd",tokensToAdd)
        const pre = tokens
        tokens = Math.min(capacity, tokens + tokensToAdd);
        // console.log("token",tokens) 
        if (tokens != pre) {
          await redisClient.hmset(key, 'tokens', tokens, 'lastRefillTime', Date.now());
        }
      }
      if (tokens >= 1) {
        tokens--;

        await redisClient.hset(key, 'tokens', tokens);

        console.log("remaining token",tokens,"time when initiated",calc)
        res.setHeader('X-RateLimit-Limit', capacity);
        res.setHeader('X-RateLimit-Remaining', Math.floor(tokens));
        res.setHeader('X-RateLimit-Retry-After', 0)
        res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Retry-After');
        next();
      }
      else {

        const retryAfter = refillInterval - (Date.now() - lastRefillTime);
        
        res.setHeader('X-RateLimit-Limit', capacity)
        res.setHeader('X-RateLimit-Remaining', 0)
        res.setHeader('X-RateLimit-Retry-After', retryAfter)
        res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Retry-After');

        return res.status(429).json({
          error: "too many requests"
        });

      }


    } catch (err) {
      next(err);
    }
  },

  // using redis sorted sets
  tokenbucket: async (req, res, next) => {
    try {
      const key = `global_token_bucket_2`;  
      const capacity = 3;  
      const refillRate = 3;  
      const refillInterval = 1000; 
      const currentTime = Date.now();

      // Check the token status from the sorted set
      // const result = await new Promise((resolve, reject) => {
      //   redisClient.zrangebyscore(key, -1, -1, 'WITHSCORES', (err, reply) => {
      //     if (err) reject(err);
      //     else resolve(reply);
      //   });
      // });
      const result = await new Promise((resolve, reject) => {
        redisClient.zrange(key, -1, -1, 'WITHSCORES', (err, reply) => {
          if (err) reject(err);
          else resolve(reply);
        });
      });
      console.log(result)

      let tokens = 0;
      let lastRefillTime = currentTime;

      // If result exists, parse the token count and last refill time
      if (result.length > 0) {
        tokens = parseInt(result[0]);  // The first element is the token count
        lastRefillTime = parseInt(result[1]);  // The second element is the last refill time
      } else {
        tokens = capacity;  // If no result, initialize with full capacity
      }

      // Calculate how much time has passed since the last refill
      const timeElapsed = currentTime - lastRefillTime;

      if (timeElapsed >= refillInterval) {
        // Refill tokens based on time elapsed
        const tokensToAdd = Math.floor((timeElapsed / refillInterval) * refillRate);
        tokens = Math.min(capacity, tokens + tokensToAdd);  // Limit tokens to the max capacity
        lastRefillTime = currentTime;

        // Update the sorted set with new token count and the last refill time
        await new Promise((resolve, reject) => {
          redisClient.zadd(key, currentTime, tokens, (err, reply) => {
            if (err) reject(err);
            else resolve(reply);
          });
        });
      }

      // Check if there are tokens available
      if (tokens >= 1) {
        tokens--;  // Decrement the token count
        console.log(tokens)

        // Update the sorted set with the new token count
        // await new Promise((resolve, reject) => {
        //   redisClient.zadd(key, lastRefillTime, tokens, (err, reply) => {
        //     if (err) reject(err);
        //     else resolve(reply);
        //   });
        // }); 

        // Example for removing the old member and adding a new token count
        await new Promise((resolve, reject) => {
          // Remove the old member
          redisClient.zrem(key, lastRefillTime, tokens+1, (err, reply) => {  // Remove by currentTime (or unique identifier for the member)
            if (err) reject(err);
            else {
              // Now, add the updated member with the new token count
              redisClient.zadd(key, lastRefillTime, tokens, (err, reply) => {
                if (err) reject(err);
                else resolve(reply);
              });
            }
          });
        });


        // Set the rate limit headers
        res.setHeader('X-RateLimit-Limit', capacity);
        res.setHeader('X-RateLimit-Remaining', tokens);
        res.setHeader('X-RateLimit-Retry-After', 0);
        res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Retry-After');
        return next();
      } else {
        // const retryAfter = refillInterval - timeElapsed;
        const retryAfter = refillInterval - (Date.now() - lastRefillTime);
        // Set the rate limit headers for retry after
        res.setHeader('X-RateLimit-Limit', capacity);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader('X-RateLimit-Retry-After', retryAfter);
        res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Retry-After');

        return res.status(429).json({
          error: "Too many requests"
        });
      }

    } catch (err) {
      console.error("Error in token bucket:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  // using lua script plus sorted sets
  tokenbucket1: async (req, res, next) => {
    try {
      const key = `global_token_bucket_3`;  
      const capacity = 20;  
      const refillRate = 20;  
      const refillInterval = 60000; 
      const currentTime = Date.now();
  
      // Lua script to handle the token update and refill logic atomically
      const luaScript = `
        local currentTime = tonumber(ARGV[1])
        local capacity = tonumber(ARGV[2])
        local refillRate = tonumber(ARGV[3])
        local refillInterval = tonumber(ARGV[4])
        local key = KEYS[1]
  
        -- Get the last element (the most recent one)
        local result = redis.call('zrange', key, -1, -1, 'WITHSCORES')
  
        local tokens = capacity
        local lastRefillTime = currentTime
  
        if #result > 0 then
          -- If a result exists, parse the token count and last refill time
          tokens = tonumber(result[1])
          lastRefillTime = tonumber(result[2])
        end
  
        -- Calculate time elapsed since last refill
        local timeElapsed = currentTime - lastRefillTime
  
        if timeElapsed >= refillInterval then
          -- Refill tokens based on the elapsed time
          local tokensToAdd = math.floor(timeElapsed / refillInterval) * refillRate
          tokens = math.min(capacity, tokens + tokensToAdd)  -- Ensure tokens don't exceed capacity
          lastRefillTime = currentTime
          redis.call('zadd', key, lastRefillTime, tostring(tokens))
        end
  
        -- Check if tokens are available and decrement if so
        if tokens >= 1 then
          tokens = tokens - 1
          -- Remove the old member and add the new one with the updated token count and last refill time
          redis.call('zrem', key, tostring(lastRefillTime),tostring(tokens+1))
          redis.call('zadd', key, lastRefillTime, tostring(tokens))

          return {tokens,lastRefillTime}
          -- Return the remaining tokens after decrement
        else
          -- If no tokens are available, return -1 or an error
          return {-1,lastRefillTime}
        end
      `;
  
      // Call the Lua script with the necessary arguments
      const result = await new Promise((resolve, reject) => {
        redisClient.eval(luaScript, 1, key, currentTime, capacity, refillRate, refillInterval, (err, reply) => {
          if (err) {
            reject(err);
          } else {
            resolve(reply);
          }
        });
      });
  
      // If result is -1, it means there are no tokens available
      if (result[0] === -1) {
        const timeElapsed = currentTime - result[1];
        const retryAfter = refillInterval - timeElapsed;
  
        res.setHeader('X-RateLimit-Limit', capacity);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader('X-RateLimit-Retry-After', retryAfter);
        res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Retry-After');
  
        return res.status(429).json({
          error: "Too many requests"
        });
      }
      
      console.log(result[0])
      // Otherwise, return the remaining tokens
      res.setHeader('X-RateLimit-Limit', capacity);
      res.setHeader('X-RateLimit-Remaining', result[0]);
      res.setHeader('X-RateLimit-Retry-After', 0);
      res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Retry-After');
      
      return next();
  
    } catch (err) {
      console.error("Error in token bucket:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
  
 
  // using lua script with redis hash
  tokenbucket3: async (req, res, next) => {
    try {
      const key = `global_token_bucket_4`;  
      const capacity = 20;  
      const refillRate = 20;  
      const refillInterval = 60000; 
      const currentTime = Date.now();
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      const seconds = now.getSeconds().toString().padStart(2, '0');
      const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
      const calc=`${hours}:${minutes}:${seconds}:${milliseconds}`
  
      const luaScript = `
        local currentTime = tonumber(ARGV[1])
        local capacity = tonumber(ARGV[2])
        local refillRate = tonumber(ARGV[3])
        local refillInterval = tonumber(ARGV[4])
        local key = KEYS[1]
  
        -- Get the current token count and last refill time from the hash
        
        local bucket = redis.call('HMGET', key, 'tokens', 'lastRefillTime')
        local tokens = tonumber(bucket[1] or capacity)
        local lastRefillTime = tonumber(bucket[2] or currentTime)
  
        -- If no tokens exist, initialize them
        if not tokens then
          tokens = capacity
        end
  
        if not lastRefillTime then
          lastRefillTime = currentTime
        end
  
        -- Calculate time elapsed since last refill
        local timeElapsed = currentTime - lastRefillTime
  
        -- Refill tokens based on elapsed time
        if timeElapsed >= refillInterval then
          local tokensToAdd = math.floor(timeElapsed / refillInterval) * refillRate
          tokens = math.min(capacity, tokens + tokensToAdd)  
          lastRefillTime = currentTime
          -- Update the hash with new token count and last refill time
          redis.call('HMSET', key, 'tokens', tokens, 'lastRefillTime', lastRefillTime)
         
        end
  
        -- Check if tokens are available and decrement if so
        if tokens >= 1 then
          tokens = tokens - 1
          -- Update the hash with the decremented token count
          redis.call('HSET', key, 'tokens', tokens)
          return {tokens, lastRefillTime}
         
        else
          -- If no tokens are available, return -1
          return {-1, lastRefillTime}
          
        end
      `;
  
      
      const result = await new Promise((resolve, reject) => {
        redisClient.eval(luaScript, 1, key, currentTime, capacity, refillRate, refillInterval, (err, reply) => {
          if (err) {
            reject(err);
          } else {
            resolve(reply);
          }
        });
      });
  
      // If result is -1, it means there are no tokens available
      if (result[0] === -1) {
        const timeElapsed = currentTime - result[1];
        const retryAfter = refillInterval - timeElapsed;
        
        res.setHeader('X-RateLimit-Limit', capacity);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader('X-RateLimit-Retry-After', retryAfter);
        res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Retry-After');
        // console.log(result[0],calc)
        return res.status(429).json({
          error: "Too many requests"
        });
      }

      
      // console.log(result[0],calc)
      console.log("remaining token",result[0],"time when initiated",calc)
      res.setHeader('X-RateLimit-Limit', capacity);
      res.setHeader('X-RateLimit-Remaining', result[0]);
      res.setHeader('X-RateLimit-Retry-After', 0);
      res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Retry-After');
  
      return next();
  
    } catch (err) {
      console.error("Error in token bucket:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
  
}
