# =======================================================================
# SCRIPT: MIKROTIK SD-WAN MULTI-DESTINO TELEMETRIA (TRACERT+ OFICIAL v4.1)
# URL de Produção: https://tracert.tiplus.inf.br
# Medição real de RTT/latência via as-value e RouterOS v7 tonsec
# =======================================================================

/system script remove [find name="sdwan_monitor"]

/system script add dont-require-permissions=no name="sdwan_monitor" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    # --- CONFIGURACOES DO TRACERT+ ---
    :local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/sdwan"
    :local routerToken "MK-TC7FI-4027"
    :local listName "SDWAN_TARGETS"
    :local pingCount 3
    :local pingInterval 00:00:00.2
    :global foRouterName [/system identity get name]

    # Links monitorados e suas respectivas interfaces e gateways
    :local linkNames [:toarray "LINK - TIM,Link - GSM"]
    :local linkIfaces [:toarray "ether1-TIM,GSM"]
    :local linkGws [:toarray "192.168.1.1,GSM"]

    :foreach entry in=[/ip firewall address-list find list=$listName] do={
        :local targetAddress [/ip firewall address-list get $entry address]
        :local targetComment [/ip firewall address-list get $entry comment]
        :local isDynamic [/ip firewall address-list get $entry dynamic]

        :local parsedIp [:toip $targetAddress]
        :local ipParaTestar ""
        :local nomeExibicao $targetComment
        :local processar false

        :if ([:typeof $parsedIp] = "ip") do={
            :if ($isDynamic = false) do={
                :set ipParaTestar $targetAddress
                :set processar true
            }
        } else={
            # Se for FQDN (dominio), busca o IP resolvido dinamicamente pelo RouterOS
            :local dynEntry [/ip firewall address-list find list=$listName comment=$targetAddress dynamic=yes]
            :if ([:len $dynEntry] > 0) do={
                :set ipParaTestar [/ip firewall address-list get ($dynEntry->0) address]
                :set processar true
            }
        }

        :if ($processar = true) do={
            :if ([:len $nomeExibicao] = 0) do={ :set nomeExibicao $targetAddress }

            :local melhorLink ""
            :local melhorGw ""
            :local menorPerda 100
            :local menorRtt 999999
            :local linksDataJson ""

            :local rotaAtualId [/ip route find dst-address=($ipParaTestar . "/32") comment~"SDWAN_AUTO"]
            :local linkAtualName "PADRAO"
            :if ([:len $rotaAtualId] > 0) do={
                :local cmtAtual [/ip route get $rotaAtualId comment]
                :set linkAtualName [:pick $cmtAtual ([:find $cmtAtual "via "] + 4) [:len $cmtAtual]]
            }

            :for i from=0 to=([:len $linkNames] - 1) do={
                :local linkName ($linkNames->$i)
                :local ifaceName ($linkIfaces->$i)
                :local gw ($linkGws->$i)

                # Teste real de latencia no RouterOS v7 via as-value e conversao em nanosegundos
                :local pings [/ping $ipParaTestar interface=$ifaceName count=$pingCount interval=$pingInterval as-value]
                :local totalNsec 0
                :local recebidos 0

                :foreach p in=$pings do={
                    :local t ($p->"time")
                    :if ([:typeof $t] = "time") do={
                        :set totalNsec ($totalNsec + [:tonsec $t])
                        :set recebidos ($recebidos + 1)
                    }
                }

                :local perda 100
                :local mediaRtt 999999
                :if ($recebidos > 0) do={
                    :set perda (100 - (($recebidos * 100) / $pingCount))
                    :set mediaRtt ($totalNsec / $recebidos / 1000000)
                    :if ($mediaRtt = 0) do={ :set mediaRtt 1 }
                }

                :local linkJson ("{\"link\":\"" . $linkName . "\",\"gw\":\"" . $gw . "\",\"perda\":" . $perda . ",\"rtt\":" . $mediaRtt . "}")
                :if ([:len $linksDataJson] > 0) do={
                    :set linksDataJson ($linksDataJson . "," . $linkJson)
                } else={
                    :set linksDataJson $linkJson
                }

                # Selecao do melhor link priorizando Menor Perda e depois Menor RTT Real
                :if ($melhorLink = "") do={
                    :set melhorLink $linkName
                    :set melhorGw $gw
                    :set menorPerda $perda
                    :set menorRtt $mediaRtt
                } else={
                    :if ($perda < $menorPerda) do={
                        :set melhorLink $linkName
                        :set melhorGw $gw
                        :set menorPerda $perda
                        :set menorRtt $mediaRtt
                    } else={
                        :if ($perda = $menorPerda and $mediaRtt < $menorRtt) do={
                            :set melhorLink $linkName
                            :set melhorGw $gw
                            :set menorPerda $perda
                            :set menorRtt $mediaRtt
                        }
                    }
                }
            }

            # Comutacao dinamica de rota para o destino
            :local houveTroca false
            :local flagTroca "false"
            :if ($linkAtualName != $melhorLink and $melhorGw != "") do={
                :set houveTroca true
                :set flagTroca "true"
                :do { /ip route remove [find dst-address=($ipParaTestar . "/32") comment~"SDWAN_AUTO"] } on-error={}
                /ip route add dst-address=($ipParaTestar . "/32") gateway=$melhorGw comment=("SDWAN_AUTO [" . $nomeExibicao . "] via " . $melhorLink)
                /log warning message=("[TRACERT+] Destino " . $nomeExibicao . " (" . $ipParaTestar . ") agora via [" . $melhorLink . "] - RTT: " . $menorRtt . "ms | Perda: " . $menorPerda . "%")
            }

            # Envio de telemetria completa com dados reais de cada link
            :local payload ("{\"token\":\"" . $routerToken . "\",\"roteador\":\"" . $foRouterName . "\",\"nomeDestino\":\"" . $nomeExibicao . "\",\"endereco\":\"" . $ipParaTestar . "\",\"linkAtivo\":\"" . $melhorLink . "\",\"linkAnterior\":\"" . $linkAtualName . "\",\"houveTroca\":" . $flagTroca . ",\"melhorRtt\":" . $menorRtt . ",\"melhorPerda\":" . $menorPerda . ",\"testes\":[" . $linksDataJson . "]}")
            :do {
                /tool fetch http-method=post http-header-field="Content-Type: application/json" url=($apiBaseUrl . "?token=" . $routerToken) http-data=$payload keep-result=no
            } on-error={
                /log error message=("[TRACERT+] Erro ao enviar telemetria para a API (" . $nomeExibicao . ")")
            }
        }
    }
}

/system scheduler remove [find name="executa_sdwan_monitor"]
/system scheduler add interval=1m name="executa_sdwan_monitor" on-event="sdwan_monitor" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup
