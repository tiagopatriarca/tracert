# =======================================================================
# SCRIPT: OTIMIZADOR DE ROTA DINAMICA PARA SISTEMA NUVEM
# Destino monitorado: Address-List "NUVEM_SISTEMA"
# Avalia Perda de Pacotes e RTT (Latencia) entre os links
# =======================================================================

# -----------------------------------------------------------------------
# PARTE 1: Criação da Tabela FIB (RouterOS v7) e Rota Inicial
# -----------------------------------------------------------------------
:do {
    /routing table add name="rota-nuvem" fib
} on-error={}

# Regra no Mangle para direcionar o tráfego da Address-List para a tabela 'rota-nuvem'
:if ([:len [/ip firewall mangle find comment="REDIRECIONA_NUVEM_SISTEMA"]] = 0) do={
    /ip firewall mangle add chain=prerouting dst-address-list="NUVEM_SISTEMA" action=mark-routing new-routing-mark="rota-nuvem" passthrough=no comment="REDIRECIONA_NUVEM_SISTEMA"
}

# -----------------------------------------------------------------------
# PARTE 2: Script de Decisao e Otimizacao
# -----------------------------------------------------------------------
/system script remove [find name="otimizar_rota_nuvem"]
/system script add dont-require-permissions=no name="otimizar_rota_nuvem" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    # --- CONFIGURACOES ---
    :local listName "NUVEM_SISTEMA"
    :local pingCount 5
    :local pingInterval 00:00:00.2
    :local pingTimeout 1000ms
    :local margemTrocaMs 25      ;# Só troca se a diferenca for maior que 25ms (evita flapping)
    :local routerName [/system identity get name]

    # Busca o primeiro IP cadastrado na address-list
    :local targetIp ""
    :foreach entry in=[/ip firewall address-list find list=$listName] do={
        :if ($targetIp = "") do={
            :set targetIp [/ip firewall address-list get $entry address]
        }
    }

    :if ($targetIp = "") do={
        /log debug message=("[ROTA_NUVEM] Nenhum IP configurado na address-list: " . $listName)
        :error "Nenhum IP encontrado"
    }

    # Armazena métricas de cada link
    :local melhorLink ""
    :local melhorGw ""
    :local menorPerda 100
    :local menorRtt 999999

    # Recupera a rota atual da nuvem
    :local rotaAtualId [/ip route find routing-table="rota-nuvem" comment~"NUVEM_SISTEMA"]
    :local linkAtualName ""
    :if ([:len $rotaAtualId] > 0) do={
        :local cmtAtual [/ip route get $rotaAtualId comment]
        :set linkAtualName [:pick $cmtAtual ([:find $cmtAtual "via "] + 4) [:len $cmtAtual]]
    }

    # Avalia cada link que possui tabela de teste (criada pelo script de failover)
    :foreach i in=[/ip route find dst-address=0.0.0.0/0 routing-mark<>""] do={
        :local cmt [/ip route get $i comment]
        
        # Ignora rotas de teste
        :if ([:len $cmt] > 0 and !($cmt ~ "!==")) do={
            :local gw [/ip route get $i gateway]

            # Sanitiza nome da tabela de teste
            :local safeCmt ""
            :for idx from=0 to=([:len $cmt] - 1) do={
                :local char [:pick $cmt $idx ($idx + 1)]
                :if ($char = " ") do={ :set char "-" }
                :set safeCmt ($safeCmt . $char)
            }
            :local tabTeste ("rota-de-teste-para-" . $safeCmt)

            # Executa os pings medindo perda e latência
            :local recebidos 0
            :local somaRtt 0

            :for p from=1 to=$pingCount do={
                :do {
                    /tool flood-ping address=$targetIp routing-table=$tabTeste count=1 size=64 timeout=$pingTimeout do={
                        :if ($"sent" = 1 and $"received" = 1) do={
                            :set recebidos ($recebidos + 1)
                            :set somaRtt ($somaRtt + $"avg-rtt")
                        }
                    }
                } on-error={
                    # Fallback com ping padrão caso flood-ping não esteja disponível
                    :local pRes [ping $targetIp routing-table=$tabTeste count=1 interval=00:00:00.2]
                    :if ($pRes = 1) do={
                        :set recebidos ($recebidos + 1)
                    }
                }
            }

            # Calcula porcentagem de perda
            :local perda (100 - (($recebidos * 100) / $pingCount))
            :local mediaRtt 999999
            :if ($recebidos > 0) do={
                :set mediaRtt ($somaRtt / $recebidos)
            }

            /log debug message=("[ROTA_NUVEM] Link: " . $cmt . " -> Perda: " . $perda . "% | RTT: " . $mediaRtt . "ms")

            # Avaliação de melhor rota:
            # 1. Menor perda de pacotes
            # 2. Se a perda for igual, menor latência
            :if ($melhorLink = "") do={
                :set melhorLink $cmt
                :set melhorGw $gw
                :set menorPerda $perda
                :set menorRtt $mediaRtt
            } else={
                :if ($perda < $menorPerda) do={
                    :set melhorLink $cmt
                    :set melhorGw $gw
                    :set menorPerda $perda
                    :set menorRtt $mediaRtt
                } else={
                    :if ($perda = $menorPerda and $mediaRtt < $menorRtt) do={
                        :set melhorLink $cmt
                        :set melhorGw $gw
                        :set menorPerda $perda
                        :set menorRtt $mediaRtt
                    }
                }
            }
        }
    }

    # -------------------------------------------------------------------
    # Decisao de Troca
    # -------------------------------------------------------------------
    :local precisaTrocar false

    :if ($linkAtualName = "") do={
        :set precisaTrocar true
    } else={
        :if ($melhorLink != $linkAtualName) do={
            # Se o link atual tiver perda e o melhor não tiver perda -> Troca
            :if ($menorPerda = 0) do={
                :set precisaTrocar true
            } else={
                # Se ambos têm a mesma perda, verifica se a diferença de RTT compensa a troca
                :if ($menorRtt < 999999) do={
                    :set precisaTrocar true
                }
            }
        }
    }

    :if ($precisaTrocar = true and $melhorGw != "") do={
        /log warning message=("[ROTA_NUVEM] Otimizando rota para o sistema nuvem (" . $targetIp . "): alterado de [" . $linkAtualName . "] para [" . $melhorLink . "] (RTT: " . $menorRtt . "ms | Perda: " . $menorPerda . "%)")

        # Atualiza ou cria a rota para nuvem
        /ip route remove [find routing-table="rota-nuvem" comment~"NUVEM_SISTEMA"]
        /ip route add dst-address=0.0.0.0/0 gateway=$melhorGw routing-table="rota-nuvem" comment=("NUVEM_SISTEMA - via " . $melhorLink)

        # Envia notificacao para o n8n
        :local dadosN8n ("roteador=" . $routerName . "&evento=ROTA_OTIMIZADA&destino=" . $targetIp . "&novoLink=" . $melhorLink . "&linkAnterior=" . $linkAtualName . "&latencia=" . $menorRtt . "&perda=" . $menorPerda)
        :do {
            /tool fetch http-method=post http-data=$dadosN8n url="https://n8n.tiplus.inf.br/webhook/749361da-2d2b-42e5-b935-66310db69f0c" keep-result=no
        } on-error={}
    }
}

# -----------------------------------------------------------------------
# PARTE 3: Agendador (Verifica a cada 1 minuto)
# -----------------------------------------------------------------------
/system scheduler remove [find name="executa_otimizador_nuvem"]
/system scheduler add interval=1m name="executa_otimizador_nuvem" on-event="otimizar_rota_nuvem" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup
