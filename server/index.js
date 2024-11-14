require('dotenv').config();
const express=require('express')
const cors=require('cors')
const rateLimiter=require('./middleware/rate-limiter') 
const controller=require('./controllers/controller')

const app=express()
app.use(express.json());

app.use(cors(
    {
        origin: 'http://127.0.0.1:5500',
        methods: ['GET', 'POST'], 
        allowedHeaders: ['Content-Type', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'] 
    }
))


app.get('/tokenbucket',rateLimiter.tokenbucket3,controller.handleRequest)


app.get('/',async(req,res)=>{
    res.status(200).json(
        "success"
    )
})

app.listen(process.env.PORT,()=>{
    console.log("server is listening on port 4000")
})