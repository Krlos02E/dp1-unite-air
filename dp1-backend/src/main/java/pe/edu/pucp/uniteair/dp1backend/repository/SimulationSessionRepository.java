package pe.edu.pucp.uniteair.dp1backend.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import pe.edu.pucp.uniteair.dp1backend.entity.SimulationSession;

import java.util.Collection;
import java.util.Optional;

@Repository
public interface SimulationSessionRepository extends JpaRepository<SimulationSession, String> {
    Optional<SimulationSession> findTopByEstadoInOrderByCreatedAtDesc(Collection<String> estados);
}
