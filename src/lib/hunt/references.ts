export interface HuntReference { id: string; referenceTitle: string; referenceSource: string; referenceUrl: string; referenceType: string; lastReviewedAt: string }
export const HUNT_REFERENCES: Record<string, HuntReference[]> = {
  "auth-bypass": [
    {
      "id": "98bdbe4a10c0",
      "referenceTitle": "02-Bypassing Authorization Schema",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/05-Authorization/02-Bypassing_Authorization_Schema.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "bf682f33eb8f",
      "referenceTitle": "Authorization Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Authorization_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ff615e5ed7fa",
      "referenceTitle": "idor",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/idor.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-access-control",
      "referenceTitle": "Web Security Academy: access-control",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/access-control",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "idor": [
    {
      "id": "7c6fe873a4d4",
      "referenceTitle": "04-Insecure Direct Object References",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/05-Authorization/04-Insecure_Direct_Object_References.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "3ddce774322e",
      "referenceTitle": "Insecure Direct Object Reference Prevention Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ff615e5ed7fa",
      "referenceTitle": "idor",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/idor.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-access-control-idor",
      "referenceTitle": "Web Security Academy: access-control/idor",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/access-control/idor",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "bola": [
    {
      "id": "5c70e195aaf0",
      "referenceTitle": "02-API Broken Object Level Authorization",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/12-API_Testing/02-API_Broken_Object_Level_Authorization.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "bf682f33eb8f",
      "referenceTitle": "Authorization Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Authorization_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ff615e5ed7fa",
      "referenceTitle": "idor",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/idor.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-access-control-idor",
      "referenceTitle": "Web Security Academy: access-control/idor",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/access-control/idor",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "xss": [
    {
      "id": "659d7d1296a5",
      "referenceTitle": "01-Reflected Cross Site Scripting",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/01-Reflected_Cross_Site_Scripting.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "bdd71f7326f9",
      "referenceTitle": "Cross Site Scripting Prevention Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "80c00744c2f4",
      "referenceTitle": "README",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/xss-cross-site-scripting/README.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-cross-site-scripting",
      "referenceTitle": "Web Security Academy: cross-site-scripting",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/cross-site-scripting",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "csrf": [
    {
      "id": "4d00a1a2f73a",
      "referenceTitle": "05-Cross Site Request Forgery",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/06-Session_Management/05-Cross_Site_Request_Forgery.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "4bedb210ca88",
      "referenceTitle": "Cross-Site Request Forgery Prevention Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "48ecb3560c8f",
      "referenceTitle": "csrf-cross-site-request-forgery",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/csrf-cross-site-request-forgery.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-csrf",
      "referenceTitle": "Web Security Academy: csrf",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/csrf",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "sqli": [
    {
      "id": "4af3727a7322",
      "referenceTitle": "05-SQL Injection",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/05-SQL_Injection.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "9ad835fd5ad2",
      "referenceTitle": "SQL Injection Prevention Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "5344ba84eb1e",
      "referenceTitle": "README",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/sql-injection/README.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-sql-injection",
      "referenceTitle": "Web Security Academy: sql-injection",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/sql-injection",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "command-injection": [
    {
      "id": "0688c54e60fa",
      "referenceTitle": "12-Command Injection",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/12-Command_Injection.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "0ba594fd1760",
      "referenceTitle": "OS Command Injection Defense Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "90aca1482e46",
      "referenceTitle": "command-injection",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/command-injection.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-os-command-injection",
      "referenceTitle": "Web Security Academy: os-command-injection",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/os-command-injection",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "ssrf": [
    {
      "id": "49f3b9c24904",
      "referenceTitle": "19-Server-Side Request Forgery",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/19-Server-Side_Request_Forgery.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "3533a4ba8d2e",
      "referenceTitle": "Server Side Request Forgery Prevention Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "b25e77eea94d",
      "referenceTitle": "README",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/ssrf-server-side-request-forgery/README.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-ssrf",
      "referenceTitle": "Web Security Academy: ssrf",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/ssrf",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "xxe": [
    {
      "id": "a6b3622d37b5",
      "referenceTitle": "07-XML Injection",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/07-XML_Injection.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "361289a22f1e",
      "referenceTitle": "XML External Entity Prevention Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "fed8adb5c0c7",
      "referenceTitle": "xxe-xee-xml-external-entity",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/xxe-xee-xml-external-entity.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-xxe",
      "referenceTitle": "Web Security Academy: xxe",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/xxe",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "ssti": [
    {
      "id": "7c82e2c8fca3",
      "referenceTitle": "18-Server-side Template Injection",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/18-Server-side_Template_Injection.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "da1f0856732d",
      "referenceTitle": "Server Side Template Injection Prevention Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Server_Side_Template_Injection_Prevention_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "bc77f90c43f0",
      "referenceTitle": "README",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/ssti-server-side-template-injection/README.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-server-side-template-injection",
      "referenceTitle": "Web Security Academy: server-side-template-injection",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/server-side-template-injection",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "cors": [
    {
      "id": "d2bcc951842c",
      "referenceTitle": "07-Cross Origin Resource Sharing",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/11-Client-side/07-Cross_Origin_Resource_Sharing.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "5b5f56e88b81",
      "referenceTitle": "HTML5 Security Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/HTML5_Security_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "3a341d064b3c",
      "referenceTitle": "cors-bypass",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/cors-bypass.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-cors",
      "referenceTitle": "Web Security Academy: cors",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/cors",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "jwt": [
    {
      "id": "0acfa47e497c",
      "referenceTitle": "10-JSON Web Tokens",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/06-Session_Management/10-JSON_Web_Tokens.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "d6ee792740dc",
      "referenceTitle": "JSON Web Token Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/JSON_Web_Token_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "db0c9d520be1",
      "referenceTitle": "hacking-jwt-json-web-tokens",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/hacking-jwt-json-web-tokens.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-jwt",
      "referenceTitle": "Web Security Academy: jwt",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/jwt",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "rfc-8725",
      "referenceTitle": "IETF RFC 8725",
      "referenceSource": "IETF",
      "referenceUrl": "https://www.rfc-editor.org/rfc/rfc8725.html",
      "referenceType": "STANDARD",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "oauth": [
    {
      "id": "e60ee2b0c29c",
      "referenceTitle": "05.1-OAuth Authorization Server Weaknesses",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/05-Authorization/05.1-OAuth_Authorization_Server_Weaknesses.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "28fe4a7e5d35",
      "referenceTitle": "OAuth2 Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/OAuth2_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "d8a5110fdca6",
      "referenceTitle": "oauth-to-account-takeover",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/oauth-to-account-takeover.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-oauth",
      "referenceTitle": "Web Security Academy: oauth",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/oauth",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "rfc-9700",
      "referenceTitle": "IETF RFC 9700",
      "referenceSource": "IETF",
      "referenceUrl": "https://www.rfc-editor.org/rfc/rfc9700.html",
      "referenceType": "STANDARD",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "lfi": [
    {
      "id": "c1dfc66cc743",
      "referenceTitle": "01-Directory Traversal File Include",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/05-Authorization/01-Directory_Traversal_File_Include.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "1bd110423e37",
      "referenceTitle": "Input Validation Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Input_Validation_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ef3910121d98",
      "referenceTitle": "README",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/file-inclusion/README.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-file-path-traversal",
      "referenceTitle": "Web Security Academy: file-path-traversal",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/file-path-traversal",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "deserialization": [
    {
      "id": "26a7b1aae5c2",
      "referenceTitle": "23-Insecure Deserialization",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/23-Insecure_Deserialization.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "e50b9d46a939",
      "referenceTitle": "Deserialization Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Deserialization_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "2f07d71109cb",
      "referenceTitle": "README",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/deserialization/README.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-deserialization",
      "referenceTitle": "Web Security Academy: deserialization",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/deserialization",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "business-logic-race": [
    {
      "id": "e6404cd9ed80",
      "referenceTitle": "04-Process Timing",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/10-Business_Logic/04-Process_Timing.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "c2ace7c13087",
      "referenceTitle": "Business Logic Security Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Business_Logic_Security_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "4e74a98460f9",
      "referenceTitle": "race-condition",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/race-condition.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-race-conditions",
      "referenceTitle": "Web Security Academy: race-conditions",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/race-conditions",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "business-logic-tamper": [
    {
      "id": "eb0d6f907314",
      "referenceTitle": "01-Business Logic Data Validation",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/10-Business_Logic/01-Business_Logic_Data_Validation.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "c2ace7c13087",
      "referenceTitle": "Business Logic Security Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Business_Logic_Security_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "b435f1b79e7b",
      "referenceTitle": "business-logic-vulnerabilities",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/business-logic-vulnerabilities.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-logic-flaws",
      "referenceTitle": "Web Security Academy: logic-flaws",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/logic-flaws",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "business-logic-workflow": [
    {
      "id": "0a0e6c4edb2e",
      "referenceTitle": "06-Circumvention of Work Flows",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/10-Business_Logic/06-Circumvention_of_Work_Flows.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "0dd708c29b65",
      "referenceTitle": "Transaction Authorization Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Transaction_Authorization_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "b435f1b79e7b",
      "referenceTitle": "business-logic-vulnerabilities",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/business-logic-vulnerabilities.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-logic-flaws",
      "referenceTitle": "Web Security Academy: logic-flaws",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/logic-flaws",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ],
  "information-disclosure": [
    {
      "id": "9b8d957d33b6",
      "referenceTitle": "04-Review Old Backup and Unreferenced Files for Sensitive Information",
      "referenceSource": "OWASP_WSTG",
      "referenceUrl": "https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management/04-Review_Old_Backup_and_Unreferenced_Files_for_Sensitive_Information.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "0629e75f4c53",
      "referenceTitle": "Error Handling Cheat Sheet",
      "referenceSource": "OWASP_CHEAT_SHEET",
      "referenceUrl": "https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Error_Handling_Cheat_Sheet.md",
      "referenceType": "TESTING_GUIDANCE",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ddcb3c526bb8",
      "referenceTitle": "Web vulnerabilities methodology \u2014 information gathering",
      "referenceSource": "HACKTRICKS",
      "referenceUrl": "https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/web-vulnerabilities-methodology.md",
      "referenceType": "COMMUNITY_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    },
    {
      "id": "ps-information-disclosure",
      "referenceTitle": "Web Security Academy: information-disclosure",
      "referenceSource": "PORTSWIGGER_ACADEMY",
      "referenceUrl": "https://portswigger.net/web-security/information-disclosure",
      "referenceType": "VENDOR_METHODOLOGY",
      "lastReviewedAt": "2026-10-26"
    }
  ]
};
