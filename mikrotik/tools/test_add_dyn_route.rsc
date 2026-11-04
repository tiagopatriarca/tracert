:local dynEntry [/ip firewall address-list find list="SDWAN_TARGETS" comment="conttroller.tiplus.inf.br" dynamic=yes]
:local ipParaTestar [/ip firewall address-list get ($dynEntry->0) address]
:local nomeExibicao "Servidor Guacamole"
:local melhorLink "LINK - TIM"
:local melhorGw "192.168.1.1"
:local menorRtt 33
:local menorPerda 0

:do { /ip route remove [find dst-address=($ipParaTestar . "/32") comment~"SDWAN_AUTO"] } on-error={}
/ip route add dst-address=($ipParaTestar . "/32") gateway=$melhorGw comment=("SDWAN_AUTO [" . $nomeExibicao . "] via " . $melhorLink)
:put "ROTA ADICIONADA COM SUCESSO"