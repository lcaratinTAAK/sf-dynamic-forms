/**
 * Os tipos de milestone que contam como SLA do caso gerado.
 *
 * Módulo puro, sem `process.env`, pelo mesmo motivo do `contract.js`: o front
 * importa. A página de informações mostra esta lista, e ela não pode divergir
 * da que o BFF consulta.
 *
 * Comparados com `MilestoneType.Name` — texto exato, com acento, travessão e
 * erro de digitação: "Reparos – Vistoriador" é travessão (–), não hífen, e
 * "responsibillidade" é como está na org. Corrigir aqui faz o tipo sumir do
 * resultado sem erro nenhum.
 */
export const TIPOS_SLA = [
  'Agents',
  'SLA de atendimento',
  'SLA de atendimento - Closing - Anexos, Aditivos, Docs e Preferências',
  'SLA de atendimento - FR',
  'Reparos - Incêndio - 5 dias',
  'GeneralPreContractRequirements',
  'GeneralPreContractRequirements - 25 dias',
  'ListingQuality 2 Dias SLA',
  'Photos - SLA - 1 day',
  'Photos - SLA - 2 days',
  'Photography - SLA - 1 day',
  'Placas - Agendamento - SLA - 2 dias',
  'Lockbox - Logistica - SLA - 1 dia',
  'Reembolso de Reparos - SLA - 2 Dias',
  'Reparos - Contestação de responsibillidade ou criticidade - SLA - 3 Dias',
  'Reparos – Vistoriador Danificou o Imóvel',
  'SLA Total do Atendimento - Comum',
  'SLA Total do Atendimento - Emergencial',
  'SLA Total do Atendimento - Urgente',
];
