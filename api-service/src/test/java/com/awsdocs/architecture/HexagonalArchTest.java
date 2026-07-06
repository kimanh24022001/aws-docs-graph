package com.awsdocs.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.syntax.ArchRuleDefinition;
import org.junit.jupiter.api.Test;

class HexagonalArchTest {

  private final JavaClasses classes = new ClassFileImporter().importPackages("com.awsdocs");

  @Test
  void domain_should_not_depend_on_application_or_adapters() {
    ArchRule rule =
        ArchRuleDefinition.noClasses()
            .that()
            .resideInAPackage("..domain..")
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("..application..", "..adapter..", "..infrastructure..");
    rule.check(classes);
  }

  @Test
  void application_should_not_depend_on_adapters() {
    ArchRule rule =
        ArchRuleDefinition.noClasses()
            .that()
            .resideInAPackage("..application..")
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("..adapter..")
            .allowEmptyShould(true);
    rule.check(classes);
  }

  @Test
  void adapter_in_should_not_depend_on_adapter_out() {
    ArchRule rule =
        ArchRuleDefinition.noClasses()
            .that()
            .resideInAPackage("..adapter.in..")
            .should()
            .dependOnClassesThat()
            .resideInAPackage("..adapter.out..");
    rule.check(classes);
  }
}
