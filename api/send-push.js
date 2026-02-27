const webpush = require('web-push');

// As chaves VAPID devem ser guardadas nas Variáveis de Ambiente da Vercel
const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

if (publicVapidKey && privateVapidKey) {
    webpush.setVapidDetails('mailto:exemplo@teuemail.com', publicVapidKey, privateVapidKey);
}

export default async function handler(req, res) {
    // CORS Helper
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!publicVapidKey || !privateVapidKey) {
        return res.status(500).json({ error: 'Chaves VAPID não configuradas no servidor (Variáveis de Ambiente da Vercel).' });
    }

    try {
        // Payload esperado do Webhook do Supabase (ou do front-end)
        // Opcionalmente, o Supabase Webhook vai enviar o `record` da despesa
        const body = req.body;

        // Simplificando: vamos esperar que a chamada contenha a subscrição alvo e a mensagem
        const subscription = body.subscription;
        const payload = JSON.stringify({
            title: body.title || 'Nova Despesa de Grupo!',
            body: body.message || 'Alguém adicionou uma despesa onde tu estás incluído.',
            icon: '/icons/icon-192.png'
        });

        if (!subscription) {
            return res.status(400).json({ error: 'Subscrição não fornecida.' });
        }

        await webpush.sendNotification(subscription, payload);
        return res.status(200).json({ success: true, message: 'Notificação enviada com sucesso!' });

    } catch (error) {
        console.error("Erro ao enviar notificação push:", error);
        return res.status(500).json({ error: 'Falha ao enviar notificação interna.', details: error.message });
    }
}
