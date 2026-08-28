# `FormFieldRule__c` — objeto de regras de visibilidade

Objeto custom (não Custom Metadata) que complementa o Page Layout com as regras
que ele não modela. Usado apenas pelo adaptador **UI API**.

O adaptador funciona sem ele: se o objeto não existir ou a query falhar, a POC
segue e registra um aviso em `diagnostics.warnings`.

## Campos

| Label | API Name | Tipo | Descrição |
| :---- | :---- | :---- | :---- |
| Object API Name | `ObjectApiName__c` | Text(80) | Objeto do formulário. Na POC, sempre `Case`. |
| Record Type Developer Name | `RecordTypeDeveloperName__c` | Text(80) | Qual formulário a regra afeta. |
| Target Field | `TargetField__c` | Text(80) | Campo que aparece ou some. |
| Condition Field | `ConditionField__c` | Text(80) | Campo cujo valor dispara a regra. |
| Operator | `Operator__c` | Picklist | `EQUALS`, `NOT_EQUALS`, `CONTAINS`, `STARTS_WITH`, `GREATER_THAN`, `LESS_THAN`, `IS_NULL`, `IS_NOT_NULL` |
| Value | `Value__c` | Text(255) | Valor esperado. Vazio para `IS_NULL` / `IS_NOT_NULL`. |
| Effect | `Effect__c` | Picklist | `SHOW` (a POC ignora os demais). Deixado para evolução: `HIDE`, `REQUIRE`. |
| Logic Group | `LogicGroup__c` | Text(40) | Regras do mesmo grupo são combinadas com **AND**. |
| Active | `IsActive__c` | Checkbox | Default `true`. |

`Name` (o campo padrão do objeto) pode ser Auto Number.

## Semântica adotada na POC

- Um campo **sem nenhuma regra** é sempre visível.
- Um campo **com regras** só aparece quando todas as condições do grupo forem verdadeiras.
- Campo obrigatório e **oculto** não bloqueia o envio, e seu valor não entra no payload.

## Exemplo

Formulário de alteração de dados bancários: o campo `PixKey__c` só aparece
quando `PaymentMethod__c` for `PIX`.

| Campo | Valor |
| :---- | :---- |
| `ObjectApiName__c` | `Case` |
| `RecordTypeDeveloperName__c` | `Payments_BankAccountChanges` |
| `TargetField__c` | `PixKey__c` |
| `ConditionField__c` | `PaymentMethod__c` |
| `Operator__c` | `EQUALS` |
| `Value__c` | `PIX` |
| `Effect__c` | `SHOW` |
| `LogicGroup__c` | `pix` |
| `IsActive__c` | ✓ |

Para uma condição composta (dois critérios com AND), crie **dois registros**
com o mesmo `TargetField__c` e o mesmo `LogicGroup__c`.

## Permissões

O usuário de integração da POC (o *run as* do Connected App) precisa de
**Read** no objeto e nos campos acima.

## Consulta que o adaptador executa

```sql
SELECT TargetField__c, ConditionField__c, Operator__c, Value__c,
       Effect__c, LogicGroup__c
FROM FormFieldRule__c
WHERE ObjectApiName__c = 'Case'
  AND RecordTypeDeveloperName__c = '...'
  AND IsActive__c = true
ORDER BY TargetField__c, LogicGroup__c
```

Uma query SOQL, filtrável server-side e batchável — ao contrário das chamadas
`ui-api`, que não podem ser agrupadas.
