# =======================================================================
# SCRIPT: MIKROTIK SD-WAN MULTI-DESTINO TELEMETRIA (ROUTEROS v6 OFICIAL)
# URL de Produção: https://tracert.tiplus.inf.br
# Medição real de RTT/latência via /tool flood-ping nativo do RouterOS v6
# =======================================================================

/system script remove [find name="sdwan_monitor"]

/system script add dont-require-permissions=no name="sdwan_monitor" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    # --- CONFIGURACOES DO TRACERT+ (ROUTEROS v6) ---
    :local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/sdwan"
    :local routerToken "SEU_TOKEN_AQUI"
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

        :local ipParaTestar $targetAddress
        :local nomeExibicao $targetComment
        :local processar false

        # Suporte universal FQDN v6: verifica se existe entrada dinamica resolvida com este comentario
        :local dynEntry [/ip firewall address-list find list=$listName comment=$targetAddress dynamic=yes]
        :if ([:len $dynEntry] > 0) do={
            :set ipParaTestar [/ip firewall address-list get ($dynEntry->0) address]
            :set processar true
        } else={
            :if ($isDynamic = false) do={
                :set ipParaTestar $targetAddress
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

                :local recebidos [/ping $ipParaTestar interface=$ifaceName count=$pingCount interval=$pingInterval]
                :local perda 100
                :local mediaRtt 999999

                # Medicao de RTT e Perda para RouterOS v6 via /tool flood-ping
                :if ($recebidos > 0) do={
                    :set perda (100 - (($recebidos * 100) / $pingCount))
                    :do {
                        :local fp [/tool flood-ping $ipParaTestar count=$pingCount interface=$ifaceName as-value]
                        :local rttVal ($fp->"avg-rtt")
                        :if ([:typeof $rttVal] = "num") do={
                            :set mediaRtt $rttVal
                            :if ($mediaRtt = 0) do={ :set mediaRtt 1 }
                        } else={
                            :set mediaRtt 1
                        }
                    } on-error={
                        :set mediaRtt 1
                    }
                }

                :local linkJson ("{\"link\":\"" . $linkName . "\",\"gw\":\"" . $gw . "\",\"perda\":" . $perda . ",\"rtt\":" . $mediaRtt . "}")
                :if ([:len $linksDataJson] > 0) do={
                    :set linksDataJson ($linksDataJson . "," . $linkJson)
                } else={
                    :set linksDataJson $linkJson
                }

                # Selecao do melhor link priorizando menor perda e menor RTT
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

            # Comutacao dinamica de rota para o destino no v6
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
