import axios from "axios";

const tronscanFactory = (apiKey) => axios.create({
    baseURL: 'https://apilist.tronscanapi.com/api',
    timeout: 10000,
    headers: {
        'TRON-PRO-API-KEY': apiKey
    }
})

export default tronscanFactory;