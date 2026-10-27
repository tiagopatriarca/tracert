import { db } from './db.js';

export async function sendEvolutionWhatsapp(tipoNotificacao, routerId, mensagemTexto) {
  try {
    const config = db.prepare('SELECT * FROM evolution_config WHERE id = 1').get();
    if (!config || !config.enabled || !config.base_url || !config.api_key) {
      return; // Evolution API desativada ou não configurada
    }

    // Busca quais grupos têm acesso a esse roteador e têm essa notificação ativa
    let filterColumn = 'notify_link_down';
    if (tipoNotificacao === 'SDWAN') filterColumn = 'notify_sdwan_switch';
    if (tipoNotificacao === 'ROUTER_OFFLINE') filterColumn = 'notify_router_offline';

    let groups = db.prepare(`
      SELECT g.whatsapp_number, g.name 
      FROM access_groups g
      JOIN group_routers gr ON gr.group_id = g.id
      WHERE gr.router_id = ? AND g.${filterColumn} = 1 AND g.whatsapp_number IS NOT NULL AND g.whatsapp_number != ''
    `).all(routerId);

    // Se nenhum grupo estiver explicitamente vinculado a este roteador, busca qualquer grupo com a notificacao ativa
    if (groups.length === 0) {
      groups = db.prepare(`
        SELECT g.whatsapp_number, g.name 
        FROM access_groups g
        WHERE g.${filterColumn} = 1 AND g.whatsapp_number IS NOT NULL AND g.whatsapp_number != ''
      `).all();
    }

    for (const g of groups) {
      let number = g.whatsapp_number.replace(/\D/g, '');
      if (!number.startsWith('55')) {
        number = '55' + number;
      }

      const endpoint = `${config.base_url.replace(/\/$/, '')}/message/sendText/${config.instance_name}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.api_key
        },
        body: JSON.stringify({
          number: number,
          text: mensagemTexto,
          options: {
            delay: 1200,
            presence: 'composing',
            linkPreview: false
          },
          textMessage: {
            text: mensagemTexto
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[Evolution API] Erro HTTP ${response.status} ao enviar para ${number}:`, errText);
      } else {
        console.log(`[Evolution API] Notificação enviada com sucesso para ${number}`);
      }
    }
  } catch (error) {
    console.error('[Evolution API] Falha geral no disparo:', error);
  }
}
